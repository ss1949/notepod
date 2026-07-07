import { NoteSummary } from "./tauri";

export interface QueryResultItem {
  marker: string;
  text: string;
  noteId: string;
  noteTitle: string;
  lineIndex: number;
  raw: string;
}

const TASK_MARKER_REGEX = /^(?:\s*[-*+]\s+)?(TODO|DOING|DONE|NOW|LATER|WAITING|CANCELLED)\s+(.*)$/;

/** 从 content 字符串中提取任务行 */
function extractTaskLines(content: string): string[] {
  return content.split('\n').filter((line) => TASK_MARKER_REGEX.test(line));
}

/** 兼容 NoteSummary（有 task_lines）和 Note（只有 content） */
interface QuerySource {
  id: string;
  title?: string;
  deleted_at?: number | null;
  task_lines?: string[];
  content?: string;
}

/** 解析 Logseq 风格查询，如 (todo later)、(todo now doing) */
export function executeLogseqQuery(query: string, sources: QuerySource[]): QueryResultItem[] {
  const normalized = query.trim().toLowerCase();
  // 去掉外层括号，把里面所有空白分隔的 token 都当作状态标记
  // 例如 (todo doing done) -> [TODO, DOING, DONE]
  const inner = normalized.replace(/^\(?\s*/, "").replace(/\s*\)?$/, "");
  if (!inner) return [];

  const markers = inner
    .split(/\s+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (markers.length === 0) return [];

  const results: QueryResultItem[] = [];
  for (const s of sources) {
    if (s.deleted_at) continue;
    // 优先用 task_lines（非空时），否则从 content 提取
    const lines = (s.task_lines && s.task_lines.length > 0)
      ? s.task_lines
      : (s.content ? extractTaskLines(s.content) : []);
    for (const line of lines) {
      const taskMatch = line.match(TASK_MARKER_REGEX);
      if (!taskMatch) continue;
      const marker = taskMatch[1];
      const text = taskMatch[2].replace(/\s*\^[a-zA-Z0-9_-]+$/, "").trim();
      if (!markers.includes(marker)) continue;
      results.push({
        marker,
        text,
        noteId: s.id,
        noteTitle: s.title || "无标题",
        lineIndex: 0,
        raw: line,
      });
    }
  }
  return results;
}

/** 把 {{query (todo ...)}} 替换为占位符 */
export function replaceQueryMacros(
  content: string
): { content: string; queries: { placeholder: string; query: string }[] } {
  const queries: { placeholder: string; query: string }[] = [];
  let counter = 0;
  const newContent = content.replace(/\{\{query\s+\(([^)]*)\)\}\}/gi, (match, query) => {
    const placeholder = `<!--QUERY_${counter++}-->`;
    queries.push({ placeholder, query: `(${query})` });
    return placeholder;
  });
  return { content: newContent, queries };
}

export function renderQueryResults(items: QueryResultItem[]): string {
  if (items.length === 0) {
    return `<div class="query-empty text-text-muted text-[13px] py-1">没有匹配的任务</div>`;
  }
  const list = items
    .map(
      (item) =>
        `<div class="query-item flex items-center gap-2 text-[13px] py-0.5" data-note-id="${item.noteId}" data-line-index="${item.lineIndex}">
      <span class="task-marker task-marker-${item.marker.toLowerCase()}">${item.marker}</span>
      <span class="task-content flex-1 truncate">${escapeHtml(item.text)}</span>
      <span class="query-note-title text-[11px] text-text-muted truncate max-w-[120px]" title="${escapeHtml(
        item.noteTitle
      )}">${escapeHtml(item.noteTitle)}</span>
    </div>`
    )
    .join("");
  return `<div class="query-results border-l-2 border-border pl-3 my-2 space-y-1">${list}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
