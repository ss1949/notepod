import { Note, NoteSummary } from "./tauri";

/** 从笔记内容中提取所有 [[笔记标题]] 的标题列表（去重） */
export function extractWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\[\]\n]+?)\]\]/g);
  if (!matches) return [];
  const unique = new Set<string>();
  for (const m of matches) {
    unique.add(m.substring(2, m.length - 2).trim());
  }
  return [...unique];
}

/** 在预览 HTML 中，把 [[笔记标题]] 替换为带 data-note-link 属性的 span */
export function renderWikiLinksInHtml(
  html: string,
  summaries: NoteSummary[],
): { html: string; linkedNoteIds: string[] } {
  const linkedNoteIds: string[] = [];
  const titleToNote = new Map<string, NoteSummary>();
  for (const n of summaries) {
    if (n.title && !n.deleted_at) titleToNote.set(n.title.toLowerCase(), n);
  }

  const result = html.replace(/\[\[([^\[\]\n]+?)\]\]/g, (match, rawTitle) => {
    const title = String(rawTitle).trim();
    const note = titleToNote.get(title.toLowerCase());
    if (note) {
      if (!linkedNoteIds.includes(note.id)) linkedNoteIds.push(note.id);
      return `<span class="wiki-link wiki-link--exists" data-note-id="${note.id}" title="打开: ${note.title}">${title}</span>`;
    }
    return `<span class="wiki-link wiki-link--missing" data-note-title="${title}" title="新建笔记: ${title}">${title}</span>`;
  });

  return { html: result, linkedNoteIds };
}

/** 找出所有引用了指定笔记的其他笔记（反向链接） */
export function findBacklinks(targetNote: NoteSummary, allSummaries: NoteSummary[]): NoteSummary[] {
  if (!targetNote.title) return [];
  const key = targetNote.title.toLowerCase();
  const results: NoteSummary[] = [];
  for (const n of allSummaries) {
    if (n.id === targetNote.id || n.deleted_at) continue;
    const links = n.wiki_links || [];
    if (links.some((t) => t.toLowerCase() === key)) {
      results.push(n);
    }
  }
  return results;
}

/** 从 Markdown 标题生成脑图节点树 */
export interface MindMapNode {
  title: string;
  level: number;
  line: number;      // 所在行号（0-indexed）
  children: MindMapNode[];
}

export function buildMindMap(note: Note): MindMapNode | null {
  if (!note.content) return null;
  // 移除 BOM 并统一行尾符
  const content = note.content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = content.split("\n");
  console.log('[buildMindMap] title:', note.title);
  console.log('[buildMindMap] content length:', content.length);
  console.log('[buildMindMap] first 200 chars:', content.substring(0, 200));
  console.log('[buildMindMap] total lines:', lines.length);
  const root: MindMapNode = { title: note.title || "无标题", level: 0, line: -1, children: [] };
  const stack: MindMapNode[] = [root];

  let matchCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      matchCount++;
      console.log(`[buildMindMap] matched line ${i}: "${line}"`);
    }
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();

    const node: MindMapNode = { title, level, line: i, children: [] };

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  console.log('[buildMindMap] total matches:', matchCount, 'root.children:', root.children.length);

  if (root.children.length === 0) return null;
  return root;
}

/** 脑图编辑工具：重命名某一标题行 */
export function renameHeading(content: string, line: number, newTitle: string): string {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return content;
  const match = lines[line].match(/^(#{1,6})\s+(.+)$/);
  if (!match) return content;
  lines[line] = `${match[1]} ${newTitle.trim()}`;
  return lines.join("\n");
}

/** 脑图编辑工具：删除一个标题及其所属内容（直到下一个同级或更高层级的标题） */
export function deleteHeading(content: string, line: number): string {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return content;
  const match = lines[line].match(/^(#{1,6})\s+(.+)$/);
  if (!match) return content;
  const targetLevel = match[1].length;

  // 找到删除范围：从当前行开始，直到遇到一个 level <= targetLevel 的新标题
  let end = line + 1;
  while (end < lines.length) {
    const nm = lines[end].match(/^(#{1,6})\s+(.+)$/);
    if (nm && nm[1].length <= targetLevel) break;
    end++;
  }

  // 删除 [line, end-1]
  const newLines = [...lines.slice(0, line), ...lines.slice(end)];
  // 清理多余的连续空行
  return newLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 脑图编辑工具：按标题文本和层级删除节点（行号偏移时使用） */
export function deleteHeadingByTitle(content: string, title: string, level: number): string {
  const lines = content.split("\n");
  const prefix = "#".repeat(level) + " ";

  // 找到匹配的标题行
  let targetLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length === level && m[2].trim() === title) {
      targetLine = i;
      break;
    }
  }
  if (targetLine === -1) return content;

  const targetLevel = level;
  let end = targetLine + 1;
  while (end < lines.length) {
    const nm = lines[end].match(/^(#{1,6})\s+(.+)$/);
    if (nm && nm[1].length <= targetLevel) break;
    end++;
  }

  const newLines = [...lines.slice(0, targetLine), ...lines.slice(end)];
  return newLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 脑图编辑工具：按标题文本和层级重命名节点 */
export function renameHeadingByTitle(content: string, oldTitle: string, level: number, newTitle: string): string {
  const lines = content.split("\n");
  const prefix = "#".repeat(level) + " ";

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m && m[1].length === level && m[2].trim() === oldTitle) {
      lines[i] = `${prefix}${newTitle.trim()}`;
      return lines.join("\n");
    }
  }
  return content;
}

/** 脑图编辑工具：在指定父节点后新增一个子标题节点（插入到子列表末尾） */
export function addHeadingAfter(
  content: string,
  parentLine: number,     // 父节点行号（= -1 表示根/第一行）
  parentLevel: number,    // 父节点层级（根=0）
): { content: string; insertedLine: number; } {
  const lines = content.split("\n");
  const newLevel = Math.min(parentLevel + 1, 6);
  const newLine = "#".repeat(newLevel) + " 新节点";

  let insertAt: number;
  if (parentLine === -1) {
    // 根节点：追加到末尾
    insertAt = lines.length;
  } else {
    // 找到父节点所属内容块的末尾（下一个 level <= parentLevel 之前）
    let i = parentLine + 1;
    while (i < lines.length) {
      const nm = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (nm && nm[1].length <= parentLevel) break;
      i++;
    }
    insertAt = i;
  }

  // 插入新标题
  const newLines = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
  return { content: newLines.join("\n"), insertedLine: insertAt };
}

/** 从笔记集合生成图数据（用于图谱） */
export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  linkCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export function buildGraphData(summaries: NoteSummary[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const activeNotes = summaries.filter((n) => !n.deleted_at && n.title);
  const titleToId = new Map<string, string>();
  for (const n of activeNotes) titleToId.set(n.title.toLowerCase(), n.id);

  // 先创建节点
  const nodes: GraphNode[] = activeNotes.map((n, i) => {
    const angle = (i / Math.max(1, activeNotes.length)) * Math.PI * 2;
    return {
      id: n.id,
      label: n.title || "无标题",
      x: Math.cos(angle) * 150,
      y: Math.sin(angle) * 150,
      vx: 0,
      vy: 0,
      linkCount: 0,
    };
  });

  const edges: GraphEdge[] = [];
  for (const n of activeNotes) {
    const links = n.wiki_links || [];
    for (const linkTitle of links) {
      const targetId = titleToId.get(linkTitle.toLowerCase());
      if (targetId && targetId !== n.id) {
        edges.push({ source: n.id, target: targetId });
      }
    }
  }

  // 统计链接数
  const countMap = new Map<string, number>();
  for (const e of edges) {
    countMap.set(e.source, (countMap.get(e.source) || 0) + 1);
    countMap.set(e.target, (countMap.get(e.target) || 0) + 1);
  }
  for (const node of nodes) {
    node.linkCount = countMap.get(node.id) || 0;
  }

  return { nodes, edges };
}
