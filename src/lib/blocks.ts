import { NoteSummary } from "./tauri";

export interface Block {
  id: string;
  noteId: string;
  noteTitle: string;
  lineIndex: number;
  content: string; // 行内容（已去掉 block id）
  raw: string; // 原始行
}

const BLOCK_ID_REGEX = /\s*\^([a-zA-Z0-9_-]+)$/;
const LIST_ITEM_REGEX = /^(\s*)[-*+]\s+(.*)$/;

/** 生成短 ID */
function generateBlockId(): string {
  return "b" + Math.random().toString(36).slice(2, 10);
}

/** 从行尾提取 block id */
export function extractBlockId(line: string): string | null {
  const match = line.match(BLOCK_ID_REGEX);
  return match ? match[1] : null;
}

/** 去掉行尾的 block id */
export function stripBlockId(line: string): string {
  return line.replace(BLOCK_ID_REGEX, "");
}

/** 确保所有列表项都有 block id */
export function ensureBlockIds(content: string): string {
  const lines = content.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!LIST_ITEM_REGEX.test(line)) continue;
    if (extractBlockId(line)) continue;
    lines[i] = line + " ^" + generateBlockId();
    changed = true;
  }
  return changed ? lines.join("\n") : content;
}

/** 从所有笔记摘要构建全局 block 索引（使用 summary 的 block_ids 字段） */
export function buildBlockIndex(
  summaries: NoteSummary[],
  currentNoteId?: string,
  currentContent?: string
): Map<string, Block> {
  const index = new Map<string, Block>();
  for (const s of summaries) {
    if (s.deleted_at) continue;
    // 当前编辑笔记：从实际 content 解析（summary 的 block_ids 可能陈旧）
    if (s.id === currentNoteId && currentContent) {
      const lines = currentContent.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!LIST_ITEM_REGEX.test(line)) continue;
        const id = extractBlockId(line);
        if (!id) continue;
        index.set(id, {
          id,
          noteId: s.id,
          noteTitle: s.title || "无标题",
          lineIndex: i,
          content: stripBlockId(line).trim(),
          raw: line,
        });
      }
      continue;
    }
    // 其他笔记：使用 summary 的 block_ids
    for (const [id, content] of (s.block_ids || [])) {
      index.set(id, {
        id,
        noteId: s.id,
        noteTitle: s.title || "无标题",
        lineIndex: 0,
        content: content.trim(),
        raw: `${content} ^${id}`,
      });
    }
  }
  return index;
}

/** 把 ((block-id)) 替换为占位符，并记录引用信息 */
export function replaceBlockRefs(
  content: string
): { content: string; refs: { placeholder: string; id: string }[] } {
  const refs: { placeholder: string; id: string }[] = [];
  let counter = 0;
  const newContent = content.replace(/\(\(([a-zA-Z0-9_-]+)\)\)/g, (match, id) => {
    const placeholder = `<!--BLOCK_REF_${counter++}-->`;
    refs.push({ placeholder, id });
    return placeholder;
  });
  return { content: newContent, refs };
}

/** 把 {{embed ((block-id))}} 替换为占位符，并记录嵌入信息 */
export function replaceBlockEmbeds(
  content: string
): { content: string; embeds: { placeholder: string; id: string }[] } {
  const embeds: { placeholder: string; id: string }[] = [];
  let counter = 0;
  const newContent = content.replace(/\{\{embed\s+\(\(([a-zA-Z0-9_-]+)\)\)\}\}/gi, (match, id) => {
    const placeholder = `<!--BLOCK_EMBED_${counter++}-->`;
    embeds.push({ placeholder, id });
    return placeholder;
  });
  return { content: newContent, embeds };
}

/** 渲染单个 block 内容（支持任务标记高亮） */
export function renderBlockContent(block: Block): string {
  const parsed = parseTaskMarker(block.content);
  if (!parsed) {
    return `<span class="block-ref-content">${escapeHtml(block.content)}</span>`;
  }
  const badgeClass = `task-marker task-marker-${parsed.marker.toLowerCase()}`;
  return `<span class="${badgeClass}">${parsed.marker}</span><span class="task-content">${escapeHtml(parsed.text)}</span>`;
}

function parseTaskMarker(line: string): { marker: string; text: string } | null {
  const markers = ["TODO", "DOING", "DONE", "NOW", "LATER", "WAITING", "CANCELLED"];
  const match = line.match(new RegExp(`^(?:\\s*[-*+]\\s+)?(${markers.join("|")})\\s+(.*)$`));
  if (!match) return null;
  return { marker: match[1], text: match[2] };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** 给指定行的列表项添加 block id，返回新内容 */
export function addBlockIdToLine(content: string, lineIndex: number): { content: string; id: string } | null {
  const lines = content.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const line = lines[lineIndex];
  if (!LIST_ITEM_REGEX.test(line)) return null;
  const existing = extractBlockId(line);
  if (existing) return { content, id: existing };
  const id = generateBlockId();
  lines[lineIndex] = line + " ^" + id;
  return { content: lines.join("\n"), id };
}
