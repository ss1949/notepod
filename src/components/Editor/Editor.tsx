import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useLayout } from "../../hooks/useLayout";
import { useIsMobile } from "../../hooks/useIsMobile";
import { MetaPanel } from "./MetaPanel/MetaPanel";
import { ToolbarToggleButton } from "../Layout/CollapsiblePanel";
import { AppleModal } from "../Layout/AppleModal";
import { api, Note, NoteSummary } from "../../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";
import katex from "katex";
import {
  renderWikiLinksInHtml, findBacklinks, buildMindMap,
  MindMapNode, renameHeading, deleteHeading, addHeadingAfter,
  deleteHeadingByTitle, renameHeadingByTitle,
} from "../../lib/wikiLinks";
import {
  ensureBlockIds,
  buildBlockIndex,
  replaceBlockRefs,
  replaceBlockEmbeds,
  renderBlockContent,
  addBlockIdToLine,
  extractBlockId,
  stripBlockId,
} from "../../lib/blocks";
import { executeLogseqQuery, replaceQueryMacros, renderQueryResults } from "../../lib/query";
import { GraphView } from "../GraphView/GraphView";
import { ProseMirrorEditor } from "./ProseMirrorEditor/ProseMirrorEditor";
import clsx from "clsx";
import "katex/dist/katex.min.css";

// LaTeX 公式渲染：支持 $...$ 行内和 $$...$$ 块级

function renderLatex(text: string): string {
  // 块级公式 $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    try {
      return `<div class="katex-block">${katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`;
    } catch {
      return `<div class="katex-error">$$${latex}$$</div>`;
    }
  });
  // 行内公式 $...$
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
    try {
      return katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      return `<span class="katex-error">$${latex}$</span>`;
    }
  });
  return text;
}

// 自定义 renderer：在代码块之后处理 LaTeX
const latexExtension = {
  name: "latex",
  level: "post" as const,
  renderer: (token: { text: string }) => renderLatex(token.text),
};

// 简单扩展：在渲染后对非代码块内容处理 LaTeX
function processLatexInHtml(html: string): string {
  // 不处理 <code> 和 <pre> 内的内容
  // 用占位符保护代码块
  const codeBlocks: string[] = [];
  let result = html.replace(/<(pre|code)[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  result = renderLatex(result);
  // 恢复代码块
  codeBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, block);
  });
  return result;
}

marked.setOptions({
  breaks: true,
  gfm: true,
});

// ===== Logseq 风格任务标记 =====
const TASK_MARKERS = ["TODO", "DOING", "DONE", "LATER", "NOW", "WAITING", "CANCELLED"] as const;
type TaskMarker = typeof TASK_MARKERS[number];

const TASK_PATTERN = new RegExp(`^((?:\\s*[-*+]\\s+)?)(${TASK_MARKERS.join("|")})(\\s+|$)`);

interface ParsedTaskLine {
  prefix: string;
  marker: TaskMarker;
  rest: string;
  startedAt?: string;
  finishedAt?: string;
  elapsed?: string;
  deadline?: string;
  scheduled?: string;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = line.match(TASK_PATTERN);
  if (!match) return null;
  const [, prefix, marker] = match;
  let rest = line.slice(match[0].length);
  rest = stripBlockId(rest).trimEnd(); // 去掉行尾 block id，避免影响属性解析

  // 支持带空格的时间格式 yyyy-MM-dd HH:mm:ss
  const startedMatch = rest.match(/started::\s*(.+?)(?=\s+(?:finished::|elapsed::|deadline::|scheduled::)|$)/);
  const finishedMatch = rest.match(/finished::\s*(.+?)(?=\s+(?:elapsed::|deadline::|scheduled::)|$)/);
  const elapsedMatch = rest.match(/elapsed::\s*(.+?)(?=\s+(?:deadline::|scheduled::)|$)/);
  const deadlineMatch = rest.match(/deadline::\s*(.+?)(?=\s+scheduled::|$)/);
  const scheduledMatch = rest.match(/scheduled::\s*(.+)$/);

  // 把已解析的属性从 rest 中剥离，避免 buildTaskLine 时重复追加
  let cleanRest = rest;
  if (startedMatch) cleanRest = cleanRest.replace(new RegExp(`\\s*started::\\s*${escapeRegExp(startedMatch[1])}`), "");
  if (finishedMatch) cleanRest = cleanRest.replace(new RegExp(`\\s*finished::\\s*${escapeRegExp(finishedMatch[1])}`), "");
  if (elapsedMatch) cleanRest = cleanRest.replace(new RegExp(`\\s*elapsed::\\s*${escapeRegExp(elapsedMatch[1])}`), "");
  if (deadlineMatch) cleanRest = cleanRest.replace(new RegExp(`\\s*deadline::\\s*${escapeRegExp(deadlineMatch[1])}`), "");
  if (scheduledMatch) cleanRest = cleanRest.replace(new RegExp(`\\s*scheduled::\\s*${escapeRegExp(scheduledMatch[1])}`), "");
  cleanRest = cleanRest.trim();

  return {
    prefix,
    marker: marker as TaskMarker,
    rest: cleanRest,
    startedAt: startedMatch?.[1]?.trim(),
    finishedAt: finishedMatch?.[1]?.trim(),
    elapsed: elapsedMatch?.[1]?.trim(),
    deadline: deadlineMatch?.[1]?.trim(),
    scheduled: scheduledMatch?.[1]?.trim(),
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins === 0) return `${hours}小时`;
    return `${hours}小时${mins}分`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (days < 7) {
    if (hrs === 0) return `${days}天`;
    return `${days}天${hrs}小时`;
  }

  const weeks = Math.floor(days / 7);
  const ds = days % 7;
  if (ds === 0) return `${weeks}周`;
  return `${weeks}周${ds}天`;
}

function formatTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function formatTimestampForPreview(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return formatTimestamp(d);
}

function stripTaskPropsFromHtml(htmlFragment: string, parsed: ParsedTaskLine): string {
  let text = htmlFragment;
  // 去掉行尾 block id，避免在预览中显示
  text = text.replace(/\s*\^[a-zA-Z0-9_-]+$/, "");
  if (parsed.startedAt) text = text.replace(new RegExp(`\\s*started::\\s*${escapeRegExp(parsed.startedAt)}`), "");
  if (parsed.finishedAt) text = text.replace(new RegExp(`\\s*finished::\\s*${escapeRegExp(parsed.finishedAt)}`), "");
  if (parsed.elapsed) text = text.replace(new RegExp(`\\s*elapsed::\\s*${escapeRegExp(parsed.elapsed)}`), "");
  if (parsed.deadline) text = text.replace(new RegExp(`\\s*deadline::\\s*${escapeRegExp(parsed.deadline)}`), "");
  if (parsed.scheduled) text = text.replace(new RegExp(`\\s*scheduled::\\s*${escapeRegExp(parsed.scheduled)}`), "");
  return text.trim();
}

function renderTaskProp(label: string, value: string, kind: "doing" | "done" | "neutral" = "neutral"): string {
  return `<span class="task-prop task-prop-${kind}"><span class="task-prop-label">${label}</span>${value}</span>`;
}

function renderTaskProps(parsed: ParsedTaskLine): string {
  const parts: string[] = [];
  // DOING / NOW 都显示开始时间
  if ((parsed.marker === "DOING" || parsed.marker === "NOW") && parsed.startedAt) {
    parts.push(renderTaskProp("开始", formatTimestampForPreview(parsed.startedAt), "doing"));
  } else if (parsed.marker === "DONE") {
    if (parsed.startedAt) parts.push(renderTaskProp("开始", formatTimestampForPreview(parsed.startedAt), "done"));
    if (parsed.finishedAt) parts.push(renderTaskProp("结束", formatTimestampForPreview(parsed.finishedAt), "done"));
    if (parsed.elapsed) parts.push(renderTaskProp("耗时", parsed.elapsed, "done"));
  }
  // 显示 deadline / scheduled 属性
  if (parsed.deadline) parts.push(renderTaskProp("截止", parsed.deadline, "neutral"));
  if (parsed.scheduled) parts.push(renderTaskProp("计划", parsed.scheduled, "neutral"));
  return parts.join("");
}

function getNextTaskMarker(marker: TaskMarker): TaskMarker {
  // Logseq 风格状态流转
  switch (marker) {
    case "TODO": return "DOING";
    case "DOING": return "DONE";
    case "DONE": return "TODO"; // 完成后可重新打开
    case "LATER": return "NOW"; // 重要不紧急 → 今天必须做
    case "NOW": return "DOING"; // 今天必须做 → 进行中
    case "WAITING": return "DOING"; // 等待中 → 进行中
    case "CANCELLED": return "TODO"; // 已取消 → 重新待办
    default: return "TODO";
  }
}

// 任务状态中文标签
const TASK_MARKER_LABELS: Record<TaskMarker, string> = {
  TODO: "待办",
  DOING: "进行中",
  DONE: "已完成",
  LATER: "稍后",
  NOW: "今天",
  WAITING: "等待",
  CANCELLED: "已取消",
};

function buildTaskLine(parsed: ParsedTaskLine): string {
  const { prefix, marker, rest, startedAt, finishedAt, elapsed } = parsed;
  let line = `${prefix}${marker} ${rest}`.trimEnd();
  const props: string[] = [];
  if (startedAt) props.push(`started:: ${startedAt}`);
  if (finishedAt) props.push(`finished:: ${finishedAt}`);
  if (elapsed) props.push(`elapsed:: ${elapsed}`);
  if (props.length > 0) line += " " + props.join(" ");
  return line;
}

function cycleTaskLine(line: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;

  const nextMarker = getNextTaskMarker(parsed.marker);
  const now = formatTimestamp(new Date());
  parsed.marker = nextMarker;

  if (nextMarker === "DOING" || nextMarker === "NOW") {
    // 进入进行中/今天必须做：记录开始时间
    if (!parsed.startedAt) parsed.startedAt = now;
    parsed.finishedAt = undefined;
    parsed.elapsed = undefined;
  } else if (nextMarker === "DONE") {
    parsed.finishedAt = now;
    if (parsed.startedAt) {
      const started = new Date(parsed.startedAt).getTime();
      const finished = new Date(now).getTime();
      parsed.elapsed = formatDuration(finished - started);
    }
  } else {
    // TODO / LATER / WAITING / CANCELLED：清除时间
    parsed.startedAt = undefined;
    parsed.finishedAt = undefined;
    parsed.elapsed = undefined;
  }

  return buildTaskLine(parsed);
}

type EditorMode = "wysiwyg" | "edit" | "preview" | "split" | "mindmap" | "graph";

export function Editor({ appLocked = false }: { appLocked?: boolean }) {
  const { currentNote, currentNoteContent, updateNoteContent, softDeleteNote, importNoteFromMd, notes, selectNote, createNote, selectedFolderId, isNewNote, filterMode, setFilterMode, createDailyNote, openDailyNote, dailyDate, graphViewOpen, setGraphViewOpen, dailyJournals, folders } = useNotesStore();
  const { sidebarCollapsed, noteListCollapsed, focusMode, toggleSidebar, toggleNoteList, toggleFocusMode } = useLayout();
  const isMobile = useIsMobile();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("preview");
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; noteId: string; noteTitle: string } | null>(null);
  const [wikiModal, setWikiModal] = useState<{ open: boolean; title: string } | null>(null);
  const [showMdMenu, setShowMdMenu] = useState(false);
  const [showMoreFormat, setShowMoreFormat] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // 移动端：监听软键盘弹出/收起
  useEffect(() => {
    if (!isMobile) return;
    const onResize = () => {
      const vv = window.visualViewport;
      if (vv) {
        setKeyboardVisible(vv.height < window.screen.height - 100);
      }
    };
    window.visualViewport?.addEventListener("resize", onResize);
    // 初始检测
    onResize();
    return () => window.visualViewport?.removeEventListener("resize", onResize);
  }, [isMobile]);
  const [slashMenu, setSlashMenu] = useState<{ open: boolean; x: number; y: number; query: string; selectedIndex: number } | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ open: boolean; x: number; y: number; lineIdx: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 检测哪些格式组被隐藏（使用 IntersectionObserver）
  useEffect(() => {
    const container = toolbarRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const hidden: string[] = [];
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            const name = entry.target.getAttribute("data-group");
            if (name) hidden.push(name);
          }
        });
        setHiddenGroups(hidden);
      },
      { root: container, threshold: 1.0 }
    );

    groupRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [mode]);

  const titleDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const lastNoteIdRef = useRef<string | null>(null);
  const syncingScrollRef = useRef<"editor" | "preview" | null>(null);
  const savingContentRef = useRef(false);

  // 切换笔记逻辑：
  // - 新建笔记 → 编辑模式
  // - 在笔记之间切换（含日志↔笔记）→ 保持当前 mode 不变
  // - 解锁后（appLocked 变化）→ 从 store 刷新解密内容
  const hadNoteRef = useRef(false);
  const lastAppLockedRef = useRef<boolean>(appLocked);
  const lastStoreContentRef = useRef<string>("");
  useEffect(() => {
    const id = currentNote?.id ?? null;
    const idChanged = id !== lastNoteIdRef.current;
    const appLockedChanged = appLocked !== lastAppLockedRef.current;
    
    if (idChanged) {
      lastNoteIdRef.current = id;
    }
    
    if (appLockedChanged) {
      lastAppLockedRef.current = appLocked;
    }

    // 解锁后刷新当前笔记的解密内容（ID 不变但内容需要更新）
    // 只有在 appLocked 状态变化时才刷新，避免编辑时覆盖用户输入
    if (!appLocked && appLockedChanged && currentNote && !idChanged) {
      setTitle(currentNote.title);
      setContent(currentNoteContent);
      latestTitleRef.current = currentNote.title;
      latestContentRef.current = currentNoteContent;
      lastStoreContentRef.current = currentNoteContent;
      return;
    }

    // 切换笔记时刷新内容
    if (idChanged && currentNote) {
      setTitle(currentNote.title);
      setContent(currentNoteContent);
      latestTitleRef.current = currentNote.title;
      latestContentRef.current = currentNoteContent;
      lastStoreContentRef.current = currentNoteContent;
      if (isNewNote) {
        setMode("edit");
      }
      // 非新建笔记：保持当前 mode 不变（笔记↔日志切换不重置）
    } else if (idChanged && !currentNote) {
      setTitle("");
      setContent("");
      latestTitleRef.current = "";
      latestContentRef.current = "";
      lastStoreContentRef.current = "";
      hadNoteRef.current = false;
    } else if (currentNote && currentNoteContent !== lastStoreContentRef.current) {
      // 跳过自己保存引发的 currentNoteContent 变化，避免 WYSIWYG 编辑器被外部替换文档
      if (savingContentRef.current) {
        lastStoreContentRef.current = currentNoteContent;
        return;
      }
      // 异步加载完成：currentNoteContent 变化但 ID 未变，更新 content
      setContent(currentNoteContent);
      latestContentRef.current = currentNoteContent;
      lastStoreContentRef.current = currentNoteContent;
    }
  }, [currentNote?.id, currentNoteContent, isNewNote, appLocked]);

  // 点击外部关闭块引用右键菜单
  useEffect(() => {
    if (!blockMenu?.open) return;
    const handler = () => setBlockMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [blockMenu?.open]);

  // 点击外部关闭斜杠命令菜单
  useEffect(() => {
    if (!slashMenu?.open) return;
    const handler = () => setSlashMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [slashMenu?.open]);

  // 双栏模式下的滚动联动
  useEffect(() => {
    if (mode !== "split") return;
    const ta = textareaRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;

    const onTaScroll = () => {
      if (syncingScrollRef.current === "preview") return;
      syncingScrollRef.current = "editor";
      const ratio = ta.scrollHeight > 0 ? ta.scrollTop / (ta.scrollHeight - ta.clientHeight || 1) : 0;
      pv.scrollTop = ratio * Math.max(0, pv.scrollHeight - pv.clientHeight);
      window.setTimeout(() => {
        syncingScrollRef.current = null;
      }, 60);
    };
    const onPvScroll = () => {
      if (syncingScrollRef.current === "editor") return;
      syncingScrollRef.current = "preview";
      const ratio = pv.scrollHeight > 0 ? pv.scrollTop / (pv.scrollHeight - pv.clientHeight || 1) : 0;
      ta.scrollTop = ratio * Math.max(0, ta.scrollHeight - ta.clientHeight);
      window.setTimeout(() => {
        syncingScrollRef.current = null;
      }, 60);
    };

    ta.addEventListener("scroll", onTaScroll);
    pv.addEventListener("scroll", onPvScroll);
    return () => {
      ta.removeEventListener("scroll", onTaScroll);
      pv.removeEventListener("scroll", onPvScroll);
    };
  }, [mode]);

  // 使用 ref 追踪最新的 title 和 content，避免 debounce 闭包捕获旧值
  const latestTitleRef = useRef<string>("");
  const latestContentRef = useRef<string>("");

  const handleTitleChange = (val: string) => {
    setTitle(val);
    latestTitleRef.current = val;
    if (currentNote && titleDebounceTimer.current) clearTimeout(titleDebounceTimer.current);
    titleDebounceTimer.current = setTimeout(() => {
      if (currentNote) {
        savingContentRef.current = true;
        updateNoteContent(currentNote.id, val, latestContentRef.current).finally(() => {
          savingContentRef.current = false;
        });
      }
    }, 500);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    latestContentRef.current = val;
    if (currentNote && contentDebounceTimer.current) clearTimeout(contentDebounceTimer.current);
    contentDebounceTimer.current = setTimeout(() => {
      if (currentNote) {
        // 保存时自动为列表项添加 block id，用于块引用
        const valWithIds = ensureBlockIds(val);
        savingContentRef.current = true;
        updateNoteContent(currentNote.id, latestTitleRef.current, valWithIds).finally(() => {
          savingContentRef.current = false;
        });
      }
    }, 500);
  };

  // ===== Markdown 格式插入 =====
  const insertMarkdown = (prefix: string, suffix: string = "", placeholder: string = "") => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end) || placeholder;
    const before = content.substring(0, start);
    const after = content.substring(end);

    const newText = before + prefix + selectedText + suffix + after;
    setContent(newText);
    handleContentChange(newText);

    requestAnimationFrame(() => {
      textarea.focus();
      if (selectedText) {
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length + selectedText.length;
      } else {
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length + placeholder.length;
      }
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const before = content.substring(0, lineStart);
    const after = content.substring(lineStart);

    const newText = before + prefix + after;
    setContent(newText);
    handleContentChange(newText);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + prefix.length;
    });
  };

  // ===== 导出 MD =====
  const handleExportMd = async () => {
    if (!currentNote) return;
    try {
      const filePath = await save({
        defaultPath: `${currentNote.title || "无标题"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await api.exportNoteMd(currentNote.id, filePath);
        alert("导出成功！");
      }
    } catch (e) {
      alert("导出失败: " + e);
    }
  };

  // ===== 导入 MD =====
  const handleImportMd = async () => {
    try {
      const file = await open({
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
        multiple: false,
      });
      if (file) {
        await importNoteFromMd(file as string);
        alert("导入成功！");
      }
    } catch (e) {
      alert("导入失败: " + e);
    }
  };

  // ===== 快捷键 =====
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.key === "b") {
      e.preventDefault();
      insertMarkdown("**", "**", "粗体文本");
    } else if (isMod && e.key === "i") {
      e.preventDefault();
      insertMarkdown("*", "*", "斜体文本");
    } else if (isMod && e.key === "k") {
      e.preventDefault();
      insertMarkdown("[", "](https://)", "链接文字");
    }

    // 斜杠命令处理
    if (slashMenu?.open) {
      const filtered = getSlashCommands().filter((c) =>
        c.label.toLowerCase().includes(slashMenu.query.toLowerCase())
      );
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenu(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered.length > 0 && slashMenu.selectedIndex >= 0 && slashMenu.selectedIndex < filtered.length) {
          executeSlashCommand(filtered[slashMenu.selectedIndex]);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenu((s) =>
          s ? { ...s, selectedIndex: Math.min(s.selectedIndex + 1, Math.max(filtered.length - 1, 0)) } : null
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenu((s) => (s ? { ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) } : null));
      }
    }
  };

  // 斜杠命令定义
  const getSlashCommands = () => [
    { label: "deadline", desc: "设置截止日期", icon: "📅", value: "deadline::", group: "日期" },
    { label: "scheduled", desc: "设置计划日期", icon: "🗓️", value: "scheduled::", group: "日期" },
    { label: "started", desc: "设置开始时间", icon: "▶️", value: "started::", group: "日期" },
    { label: "finished", desc: "设置完成时间", icon: "⏹️", value: "finished::", group: "日期" },
    { label: "TODO", desc: "待办事项", icon: "⬜", value: "TODO ", group: "任务" },
    { label: "DOING", desc: "进行中", icon: "🔵", value: "DOING ", group: "任务" },
    { label: "DONE", desc: "已完成", icon: "✅", value: "DONE ", group: "任务" },
    { label: "NOW", desc: "今天必须做", icon: "🔴", value: "NOW ", group: "任务" },
    { label: "LATER", desc: "稍后处理", icon: "🟠", value: "LATER ", group: "任务" },
    { label: "WAITING", desc: "等待中", icon: "🟡", value: "WAITING ", group: "任务" },
    { label: "query", desc: "插入查询宏", icon: "🔍", value: "{{query (todo )}}", group: "查询", cursorOffset: -3 },
  ];

  // 执行斜杠命令
  const executeSlashCommand = (cmd: { label: string; value: string; cursorOffset?: number }) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const before = content.substring(0, start);
    const after = content.substring(start);

    // 找到斜杠位置并替换
    const slashPos = before.lastIndexOf("/");
    const newBefore = slashPos >= 0 ? before.substring(0, slashPos) : before;

    // 任务标记命令：如果当前行没有列表前缀，自动补 "- "
    const TASK_MARKER_VALUES = ["TODO ", "DOING ", "DONE ", "NOW ", "LATER ", "WAITING "];
    const isTaskMarker = TASK_MARKER_VALUES.includes(cmd.value);
    let insertValue = cmd.value;
    if (isTaskMarker) {
      const lineStart = newBefore.lastIndexOf("\n") + 1;
      const lineBeforeSlash = newBefore.substring(lineStart);
      const trimmedLine = lineBeforeSlash.trim();
      const hasListPrefix = /^[-*+]\s+/.test(lineBeforeSlash);
      if (!trimmedLine && !hasListPrefix) {
        insertValue = "- " + cmd.value;
      }
    }

    const newText = newBefore + insertValue + after;
    setContent(newText);
    handleContentChange(newText);
    setSlashMenu(null);

    requestAnimationFrame(() => {
      textarea.focus();
      const offset = cmd.cursorOffset ?? 0;
      const cursorPos = Math.max(0, newBefore.length + insertValue.length + offset);
      textarea.selectionStart = textarea.selectionEnd = cursorPos;
    });
  };

  // 检测斜杠输入
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    latestContentRef.current = val;
    if (currentNote && contentDebounceTimer.current) clearTimeout(contentDebounceTimer.current);
    contentDebounceTimer.current = setTimeout(() => {
      if (currentNote) {
        savingContentRef.current = true;
        updateNoteContent(currentNote.id, latestTitleRef.current, val).finally(() => {
          savingContentRef.current = false;
        });
      }
    }, 500);

    // 检测斜杠命令
    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const beforeCursor = val.substring(0, cursorPos);
      const slashMatch = beforeCursor.match(/\/([a-zA-Z]*)$/);

      if (slashMatch) {
        const rect = textarea.getBoundingClientRect();
        const textBefore = beforeCursor.substring(0, slashMatch.index!);
        const lines = textBefore.split("\n");
        const currentLine = lines[lines.length - 1];
        const lineHeight = 24; // 近似行高
        const query = slashMatch[1];
        const filtered = getSlashCommands().filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase())
        );

        // 计算菜单位置并限制在可视区域内
        const menuWidth = 220;
        const menuHeight = 300; // 近似最大高度
        let menuX = rect.left + currentLine.length * 8 + 10;
        let menuY = rect.top + lines.length * lineHeight + 10;
        menuX = Math.max(8, Math.min(menuX, window.innerWidth - menuWidth - 8));
        if (menuY + menuHeight > window.innerHeight) {
          menuY = Math.max(8, menuY - menuHeight - lineHeight);
        }

        setSlashMenu((prev) => {
          const base = {
            open: true,
            x: menuX,
            y: menuY,
            query,
          };
          if (prev?.open) {
            const nextIndex = Math.min(prev.selectedIndex, Math.max(filtered.length - 1, 0));
            return { ...base, selectedIndex: nextIndex };
          }
          return { ...base, selectedIndex: 0 };
        });
      } else {
        setSlashMenu(null);
      }
    }
  };

  // 全局 block 索引（用于块引用/内嵌）
  const blockIndex = useMemo(() => {
    return buildBlockIndex([...notes, ...dailyJournals], currentNote?.id, content);
  }, [notes, dailyJournals, currentNote, content]);

  // 预览 HTML（支持 LaTeX 公式 + 双链 + Logseq 任务标记 + 块引用/内嵌 + Query）
  const previewHtml = useMemo(() => {
    try {
      // 预处理块引用、内嵌和 Query 宏，避免被 Markdown 解析破坏
      // 注意：先处理 embed（{{embed ((id))}} 中包含 ((id))），再处理普通 block ref
      const { content: contentWithEmbeds, embeds } = replaceBlockEmbeds(content || "*暂无内容*");
      const { content: contentWithRefs, refs } = replaceBlockRefs(contentWithEmbeds);
      const { content: contentWithQueries, queries } = replaceQueryMacros(contentWithRefs);

      const mdHtml = marked.parse(contentWithQueries) as string;
      const latexHtml = processLatexInHtml(mdHtml);
      // 保护代码块不被 wiki 替换
      const codeBlocks: string[] = [];
      let html = latexHtml.replace(/<(pre|code)[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
      });
      const { html: wikiHtml } = renderWikiLinksInHtml(html, notes);
      html = wikiHtml;
      codeBlocks.forEach((block, i) => {
        html = html.replace(`__CODE_BLOCK_${i}__`, block);
      });

      // 还原块引用
      refs.forEach(({ placeholder, id }) => {
        const block = blockIndex.get(id);
        const rendered = block
          ? `<span class="block-ref inline-flex items-center gap-1" data-block-id="${id}" title="来自: ${block.noteTitle}">${renderBlockContent(block)}</span>`
          : `<span class="block-ref block-ref--missing text-text-muted" data-block-id="${id}">((未知块: ${id}))</span>`;
        html = html.replace(placeholder, rendered);
      });

      // 还原块内嵌
      embeds.forEach(({ placeholder, id }) => {
        const block = blockIndex.get(id);
        const rendered = block
          ? `<div class="block-embed border-l-2 border-border pl-3 my-2 py-1" data-block-id="${id}">${renderBlockContent(block)}</div>`
          : `<div class="block-embed block-embed--missing text-text-muted text-[13px]" data-block-id="${id}">未知块: ${id}</div>`;
        html = html.replace(placeholder, rendered);
      });

      // 还原 Query 宏（优先使用当前编辑内容）
      queries.forEach(({ placeholder, query }) => {
        const items = executeLogseqQuery(query, [...notes, ...dailyJournals]);
        html = html.replace(placeholder, renderQueryResults(items));
      });

      // 将 Logseq 风格任务标记渲染为可点击徽章
      const contentLines = (content || "").split("\n");
      const taskLines: { lineIdx: number; marker: TaskMarker }[] = [];
      contentLines.forEach((line, i) => {
        const parsed = parseTaskLine(line);
        if (parsed) taskLines.push({ lineIdx: i, marker: parsed.marker });
      });
      let taskIndex = 0;
      // marked 可能生成 <li><p>TODO xxx</p></li> 或 <li>TODO xxx</li>
      // 需要同时匹配两种情况
      const markerPattern = new RegExp(`(<li[^>]*>(?:<p>)?)(${TASK_MARKERS.join("|")})(\\s)`, "gi");
      html = html.replace(markerPattern, (match, liTag, marker, space) => {
        const task = taskLines[taskIndex];
        taskIndex++;
        if (!task) return match;
        const label = TASK_MARKER_LABELS[task.marker] || task.marker;
        const badgeClass = `task-marker task-marker-${task.marker.toLowerCase()}`;
        const isDone = task.marker === 'DONE' || task.marker === 'CANCELLED';
        const cursor = isDone ? 'default' : 'pointer';
        return `${liTag}<span class="${badgeClass}" data-task-line="${task.lineIdx}" data-task-marker="${task.marker}" title="${label}" style="cursor:${cursor};pointer-events:${isDone ? 'none' : 'auto'};">${marker}</span>${space}`;
      });
      taskIndex = 0;
      // 用 DOM 操作代替正则，更可靠地包装任务内容和属性
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      const lis = tempDiv.querySelectorAll('li');
      lis.forEach((li) => {
        const markerSpan = li.querySelector('span.task-marker');
        if (!markerSpan) return;
        const task = taskLines[taskIndex];
        taskIndex++;
        if (!task) return;
        const parsed = parseTaskLine(contentLines[task.lineIdx]);
        if (!parsed) return;

        // 获取标记之后的所有内容
        // 先检查是否有 <p> 包裹，如果有则从 <p> 内部提取
        let contentHtml = '';
        const pElement = li.querySelector('p');
        const container = pElement || li;
        
        let foundMarker = false;
        for (let i = 0; i < container.childNodes.length; i++) {
          const child = container.childNodes[i];
          if (child === markerSpan || (child as Element).contains?.(markerSpan)) {
            foundMarker = true;
            continue;
          }
          if (!foundMarker) continue;
          if (child.nodeType === Node.TEXT_NODE) {
            contentHtml += child.textContent || '';
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            contentHtml += (child as Element).outerHTML;
          }
        }

        // 剥离任务属性和 block id
        const cleanContent = stripTaskPropsFromHtml(contentHtml, parsed);
        const propsHtml = renderTaskProps(parsed);

        // 重建 li 内容
        li.innerHTML = '';
        li.appendChild(markerSpan);
        const contentSpan = document.createElement('span');
        contentSpan.className = 'task-content';
        contentSpan.innerHTML = cleanContent;
        li.appendChild(contentSpan);
        if (propsHtml) {
          const propsDiv = document.createElement('span');
          propsDiv.innerHTML = propsHtml;
          li.appendChild(propsDiv);
        }
      });
      html = tempDiv.innerHTML;
      return html;
    } catch {
      return content;
    }
  }, [content, notes, dailyJournals, blockIndex]);

  // 反向链接（包含普通笔记与每日日志）
  const backlinks = useMemo(() => {
    if (!currentNote) return [];
    return findBacklinks(currentNote, [...notes, ...dailyJournals]);
  }, [currentNote, notes, dailyJournals]);

  // 处理预览区点击：Logseq 任务标记切换 + 双链跳转
  const handlePreviewClick = (e: React.MouseEvent | Event) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    // Logseq 任务标记点击切换
    const badge = target.closest(".task-marker") as HTMLElement | null;
    if (badge) {
      e.preventDefault();
      e.stopPropagation();

      const marker = badge.getAttribute("data-task-marker") as TaskMarker;
      if (marker === 'DONE' || marker === 'CANCELLED') return;

      const lineIdx = parseInt(badge.getAttribute("data-task-line") || "-1", 10);
      if (lineIdx < 0) return;
      const lines = content.split("\n");
      if (lineIdx >= lines.length) return;

      lines[lineIdx] = cycleTaskLine(lines[lineIdx]);

      const newContent = lines.join("\n");
      setContent(newContent);
      latestContentRef.current = newContent;
      if (currentNote) {
        savingContentRef.current = true;
        updateNoteContent(currentNote.id, latestTitleRef.current, newContent).finally(() => {
          savingContentRef.current = false;
        });
      }
      return;
    }

    // 双链跳转
    if (target.classList.contains("wiki-link") || target.closest(".wiki-link")) {
      e.stopPropagation();
      const linkEl = target.classList.contains("wiki-link") ? target : target.closest(".wiki-link")!;
      const noteId = linkEl.getAttribute("data-note-id");
      if (noteId) {
        const found = notes.find((n) => n.id === noteId);
        if (found) openLinkedNote(found);
      } else {
        const noteTitle = linkEl.getAttribute("data-note-title");
        if (noteTitle) {
          setWikiModal({ open: true, title: noteTitle });
        }
      }
    }
  };

  // 预览区右键菜单：复制块引用 / 内嵌块
  const handlePreviewContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const badge = target.closest(".task-marker") as HTMLElement | null;
    if (!badge) return;
    e.preventDefault();
    e.stopPropagation();
    const lineIdx = parseInt(badge.getAttribute("data-task-line") || "-1", 10);
    if (lineIdx < 0) return;
    setBlockMenu({ open: true, x: e.clientX, y: e.clientY, lineIdx });
  };

  const copyBlockRef = async (embed: boolean) => {
    if (!currentNote || !blockMenu) return;
    const lines = content.split("\n");
    const lineIdx = blockMenu.lineIdx;
    if (lineIdx < 0 || lineIdx >= lines.length) return;

    let id = extractBlockId(lines[lineIdx]);
    let newContent = content;
    if (!id) {
      const result = addBlockIdToLine(content, lineIdx);
      if (!result) return;
      newContent = result.content;
      id = result.id;
      setContent(newContent);
      latestContentRef.current = newContent;
      savingContentRef.current = true;
      await updateNoteContent(currentNote.id, latestTitleRef.current, newContent).finally(() => {
        savingContentRef.current = false;
      });
    }

    const ref = embed ? `{{embed ((${id}))}}` : `((${id}))`;
    try {
      await navigator.clipboard.writeText(ref);
    } catch (err) {
      console.error("复制失败:", err);
    }
    setBlockMenu(null);
  };

  // 新建被引用的笔记
  const handleCreateLinkedNote = async (linkTitle: string) => {
    try {
      const note = await api.createNote({
        title: linkTitle,
        content: "",
        folder_id: selectedFolderId || undefined,
      });
      setWikiModal(null);
      await getNotesRefresh();
      selectNote(note);
    } catch (err) {
      console.error("创建笔记失败:", err);
      setWikiModal(null);
    }
  };

  // 简易刷新笔记列表（通过 loadNotes）
  const getNotesRefresh = async () => {
    try {
      if (useNotesStore.getState().loadNotes) {
        await useNotesStore.getState().loadNotes(selectedFolderId || undefined);
      }
    } catch (_) {}
  };

  // 关系图谱数据：跨所有文件夹的笔记 + 每日日志
  const [allGraphNotes, setAllGraphNotes] = useState<NoteSummary[]>([]);
  useEffect(() => {
    const isGraphVisible = graphViewOpen || mode === "graph";
    if (!isGraphVisible) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await api.listNotesSummary();
        if (cancelled) return;
        const active = all.filter((n) => !n.deleted_at);
        console.log("[Graph] loaded all notes:", active.length, active.map((n) => ({ id: n.id, title: n.title, folder_id: n.folder_id, note_type: n.note_type })));
        setAllGraphNotes(active);
      } catch (e) {
        console.error("Failed to load graph notes:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [graphViewOpen, mode]);

  // 跨日期任务聚合数据
  const { aggregatedTasks } = useNotesStore();

  // 打开链接/图谱节点/反链时按笔记类型切换对应菜单
  const openLinkedNote = useCallback((note: NoteSummary | Note) => {
    if (note.note_type === "daily" && note.journal_date) {
      setFilterMode("daily");
      openDailyNote(note.journal_date);
      setMode("preview");
    } else {
      setFilterMode("all");
      selectNote(note);
      setMode("preview");
    }
  }, [setFilterMode, openDailyNote, selectNote]);

  const handleWikiLinkClick = useCallback((title: string) => {
    // 先尝试精确匹配普通笔记
    let found = notes.find((n) => n.title === title);
    if (found) {
      openLinkedNote(found);
      return;
    }

    // 尝试精确匹配日志
    found = dailyJournals.find((n) => n.title === title);
    if (found) {
      openLinkedNote(found);
      return;
    }

    // 尝试模糊匹配（忽略大小写、包含关系）
    const lowerTitle = title.toLowerCase();
    found = notes.find((n) => {
      const nLower = n.title.toLowerCase();
      return nLower === lowerTitle || nLower.includes(lowerTitle) || lowerTitle.includes(nLower);
    });
    if (found) {
      openLinkedNote(found);
      return;
    }

    found = dailyJournals.find((n) => {
      const nLower = n.title.toLowerCase();
      return nLower === lowerTitle || nLower.includes(lowerTitle) || lowerTitle.includes(nLower);
    });
    if (found) {
      openLinkedNote(found);
      return;
    }

    // 都没找到，提示创建
    setWikiModal({ open: true, title });
  }, [notes, dailyJournals, openLinkedNote]);

  // ===== 全局关系图谱 =====
  if (graphViewOpen) {
    return (
      <div className="h-full flex flex-col" style={{ background: "var(--color-bg-empty)" }}>
        <GraphView
          notes={allGraphNotes}
          journals={dailyJournals}
          folders={folders}
          onNodeClick={(noteId) => {
            const found = [...allGraphNotes, ...dailyJournals].find((n) => n.id === noteId);
            if (found) {
              setGraphViewOpen(false);
              openLinkedNote(found);
            }
          }}
        />
      </div>
    );
  }

  // ===== 空状态 =====
  if (!currentNote) {
    const isDailyMode = filterMode === "daily";
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ background: "var(--color-bg-empty)" }}>
        {isDailyMode ? (
          <>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <p className="mt-3 text-base font-medium text-text-muted">当天还没有日志</p>
            <button
              onClick={() => {
                console.log("创建日志按钮被点击，当前日期:", dailyDate);
                createDailyNote(dailyDate).then(() => {
                  console.log("createDailyNote 完成");
                }).catch((e) => {
                  console.error("createDailyNote 失败:", e);
                });
              }}
              className="mt-4 px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 active:scale-95"
              style={{ background: "var(--accent, #007AFF)", cursor: "pointer" }}
            >
              创建日志
            </button>
          </>
        ) : (
          <>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <p className="mt-3 text-base font-medium text-text-muted">选择或创建一条笔记</p>
            <p className="mt-1 text-[13px] text-text-muted">按 Ctrl+N 快速新建</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: "var(--color-bg-editor)",
        ...(isMobile && keyboardVisible ? { height: `${window.visualViewport?.height}px`, position: "fixed", left: 0, right: 0, top: 0, zIndex: 10 } : {}),
      }}
    >
      {/* 编辑器工具栏 */}
      <div
        className="flex items-center gap-1 flex-nowrap"
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-bg-toolbar)",
          minHeight: "44px",
        }}
      >
        {/* 侧栏/列表/专注 切换按钮（移动端隐藏） */}
        {!isMobile && (
        <div className="flex items-center gap-1 pr-2 flex-shrink-0" style={{ borderRight: "1px solid var(--color-border)" }}>
          <ToolbarToggleButton
            onClick={toggleSidebar}
            active={!sidebarCollapsed}
            label="侧栏"
            shortcut="⌘["
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            }
          />
          <ToolbarToggleButton
            onClick={toggleNoteList}
            active={!noteListCollapsed}
            label="列表"
            shortcut="⌘]"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <circle cx="4" cy="6" r="1" fill="currentColor" />
                <circle cx="4" cy="12" r="1" fill="currentColor" />
                <circle cx="4" cy="18" r="1" fill="currentColor" />
              </svg>
            }
          />
          <ToolbarToggleButton
            onClick={toggleFocusMode}
            active={!focusMode}
            label={focusMode ? "退出专注" : "专注"}
            shortcut="⌘."
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {focusMode ? (
                  <>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <line x1="3" y1="4" x2="21" y2="20" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </>
                )}
              </svg>
            }
          />
        </div>
        )}

        {/* 格式按钮组: 溢出部分自动隐藏，更多按钮弹出全部 */}
        {(mode === "edit" || mode === "split") && !(isMobile && keyboardVisible) && (
          <div className="flex items-center flex-1 min-w-0">
            {/* 格式按钮 - 使用 IntersectionObserver 检测溢出 */}
            <div ref={toolbarRef} className="flex items-center gap-1 overflow-hidden flex-shrink min-w-0" style={{ maskImage: hiddenGroups.length > 0 ? "linear-gradient(to right, black calc(100% - 24px), transparent 100%)" : "none", WebkitMaskImage: hiddenGroups.length > 0 ? "linear-gradient(to right, black calc(100% - 24px), transparent 100%)" : "none" }}>
              <div ref={(el) => el && groupRefs.current.set("text", el)} data-group="text" className="flex items-center gap-0.5 pr-2 flex-shrink-0" style={{ borderRight: "1px solid var(--color-border)" }}>
                <ToolbarBtn title="加粗 (Ctrl+B)" onClick={() => insertMarkdown("**", "**", "粗体文本")}>
                  <b>B</b>
                </ToolbarBtn>
                <ToolbarBtn title="斜体 (Ctrl+I)" onClick={() => insertMarkdown("*", "*", "斜体文本")}>
                  <i>I</i>
                </ToolbarBtn>
                <ToolbarBtn title="删除线" onClick={() => insertMarkdown("~~", "~~", "删除线文本")}>
                  <s>S</s>
                </ToolbarBtn>
                <ToolbarBtn title="行内代码" onClick={() => insertMarkdown("`", "`", "code")}>
                  <span style={{ fontFamily: "monospace", fontSize: "12px" }}>&lt;/&gt;</span>
                </ToolbarBtn>
              </div>

              {/* 标题组 */}
              <div ref={(el) => el && groupRefs.current.set("heading", el)} data-group="heading" className="flex items-center gap-0.5 px-2 flex-shrink-0" style={{ borderRight: "1px solid var(--color-border)" }}>
                <ToolbarBtn title="一级标题" onClick={() => insertLinePrefix("# ")}>H1</ToolbarBtn>
                <ToolbarBtn title="二级标题" onClick={() => insertLinePrefix("## ")}>H2</ToolbarBtn>
                <ToolbarBtn title="三级标题" onClick={() => insertLinePrefix("### ")}>H3</ToolbarBtn>
              </div>

              {/* 列表/块组 */}
              <div ref={(el) => el && groupRefs.current.set("block", el)} data-group="block" className="flex items-center gap-0.5 px-2 flex-shrink-0" style={{ borderRight: "1px solid var(--color-border)" }}>
                <ToolbarBtn title="无序列表" onClick={() => insertLinePrefix("- ")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/>
                  </svg>
                </ToolbarBtn>
                <ToolbarBtn title="有序列表" onClick={() => insertLinePrefix("1. ")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
                    <text x="1" y="8" fontSize="8" fill="currentColor" stroke="none">1</text>
                    <text x="1" y="14" fontSize="8" fill="currentColor" stroke="none">2</text>
                    <text x="1" y="20" fontSize="8" fill="currentColor" stroke="none">3</text>
                  </svg>
                </ToolbarBtn>
                <ToolbarBtn title="引用" onClick={() => insertLinePrefix("> ")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/>
                    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>
                  </svg>
                </ToolbarBtn>
                <ToolbarBtn title="代码块" onClick={() => insertMarkdown("```\n", "\n```", "代码块")}>
                  <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{"{}"}</span>
                </ToolbarBtn>
                <ToolbarBtn title="链接 (Ctrl+K)" onClick={() => insertMarkdown("[", "](https://)", "链接文字")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </ToolbarBtn>
                <ToolbarBtn title="分隔线" onClick={() => insertLinePrefix("---\n")}>—</ToolbarBtn>
                <ToolbarBtn title="任务列表" onClick={() => insertLinePrefix("- TODO ")}>☑</ToolbarBtn>
                <ToolbarBtn title="LaTeX 公式" onClick={() => insertMarkdown("$", "$", "E=mc^2")}>
                  <span style={{ fontFamily: "serif", fontStyle: "italic" }}>fx</span>
                </ToolbarBtn>
                <ToolbarBtn title="LaTeX 块级公式" onClick={() => insertMarkdown("$$\n", "\n$$", "E=mc^2")}>
                  <span style={{ fontFamily: "serif", fontStyle: "italic", fontWeight: "bold" }}>Fx</span>
                </ToolbarBtn>
                <ToolbarBtn title="双链 ([[笔记标题])" onClick={() => insertMarkdown("[[", "]]", "笔记标题")}>
                  <span style={{ fontWeight: 600 }}>[[]]</span>
                </ToolbarBtn>
              </div>
            </div>

            {/* 更多按钮 */}
            {hiddenGroups.length > 0 && (
            <div className="relative flex-shrink-0">
              <ToolbarBtn title={`更多格式 (${hiddenGroups.length})`} onClick={() => setShowMoreFormat(!showMoreFormat)}>
                <span style={{ fontWeight: 600, fontSize: "18px", lineHeight: 1 }}>»</span>
              </ToolbarBtn>
              {showMoreFormat && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoreFormat(false)} />
                  <div
                    className={`z-50 min-w-48 rounded-lg py-1 shadow-lg max-h-80 overflow-y-auto ${isMobile ? "fixed left-2 right-2 bottom-2" : "absolute right-0 top-full mt-1"}`}
                    style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}
                  >
                    {hiddenGroups.includes("text") && (<>
                      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 py-1">文本样式</div>
                      <DropdownBtn title="加粗 (Ctrl+B)" onClick={() => { setShowMoreFormat(false); insertMarkdown("**", "**", "粗体文本"); }}>B 加粗</DropdownBtn>
                      <DropdownBtn title="斜体 (Ctrl+I)" onClick={() => { setShowMoreFormat(false); insertMarkdown("*", "*", "斜体文本"); }}>I 斜体</DropdownBtn>
                      <DropdownBtn title="删除线" onClick={() => { setShowMoreFormat(false); insertMarkdown("~~", "~~", "删除线文本"); }}>S 删除线</DropdownBtn>
                      <DropdownBtn title="行内代码" onClick={() => { setShowMoreFormat(false); insertMarkdown("`", "`", "code"); }}>&lt;/&gt; 行内代码</DropdownBtn>
                    </>)}
                    {hiddenGroups.includes("heading") && (<>
                      <div className="border-t border-border my-1" />
                      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 py-1">标题</div>
                      <DropdownBtn title="一级标题" onClick={() => { setShowMoreFormat(false); insertLinePrefix("# "); }}>H1 一级标题</DropdownBtn>
                      <DropdownBtn title="二级标题" onClick={() => { setShowMoreFormat(false); insertLinePrefix("## "); }}>H2 二级标题</DropdownBtn>
                      <DropdownBtn title="三级标题" onClick={() => { setShowMoreFormat(false); insertLinePrefix("### "); }}>H3 三级标题</DropdownBtn>
                    </>)}
                    {hiddenGroups.includes("block") && (<>
                      <div className="border-t border-border my-1" />
                      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 py-1">列表 / 块</div>
                      <DropdownBtn title="无序列表" onClick={() => { setShowMoreFormat(false); insertLinePrefix("- "); }}>• 无序列表</DropdownBtn>
                      <DropdownBtn title="有序列表" onClick={() => { setShowMoreFormat(false); insertLinePrefix("1. "); }}>1. 有序列表</DropdownBtn>
                      <DropdownBtn title="引用" onClick={() => { setShowMoreFormat(false); insertLinePrefix("> "); }}>❯ 引用</DropdownBtn>
                      <DropdownBtn title="代码块" onClick={() => { setShowMoreFormat(false); insertMarkdown("```\n", "\n```", "代码块"); }}>{`{}`} 代码块</DropdownBtn>
                      <DropdownBtn title="链接 (Ctrl+K)" onClick={() => { setShowMoreFormat(false); insertMarkdown("[", "](https://)", "链接文字"); }}>🔗 链接</DropdownBtn>
                      <DropdownBtn title="分隔线" onClick={() => { setShowMoreFormat(false); insertLinePrefix("---\n"); }}>— 分隔线</DropdownBtn>
                      <DropdownBtn title="任务列表" onClick={() => { setShowMoreFormat(false); insertLinePrefix("- TODO "); }}>☑ 任务列表</DropdownBtn>
                      <DropdownBtn title="LaTeX 公式" onClick={() => { setShowMoreFormat(false); insertMarkdown("$", "$", "E=mc^2"); }}>fx 行内公式</DropdownBtn>
                      <DropdownBtn title="LaTeX 块级公式" onClick={() => { setShowMoreFormat(false); insertMarkdown("$$\n", "\n$$", "E=mc^2"); }}>Fx 块级公式</DropdownBtn>
                      <DropdownBtn title="双链 ([[笔记标题])" onClick={() => { setShowMoreFormat(false); insertMarkdown("[[", "]]", "笔记标题"); }}>[[]] 双链</DropdownBtn>
                    </>)}
                  </div>
                </>
              )}
            </div>
            )}
          </div>
        )}

        {/* 右侧按钮组 */}
        <div className="flex items-center gap-1 ml-auto">
          {/* 视图切换：全部图标平铺 */}
          <div className="flex items-center rounded-md overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            {([
              { key: "preview", label: "预览", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )},
              { key: "wysiwyg", label: "所见即所得", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                  <path d="M2 2l7.586 7.586"/>
                  <circle cx="11" cy="11" r="2"/>
                </svg>
              )},
              { key: "edit", label: "编辑", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6"/>
                  <polyline points="8 6 2 12 8 18"/>
                </svg>
              )},
              { key: "split", label: "双栏", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="12" y1="3" x2="12" y2="21"/>
                </svg>
              )},
              { key: "mindmap", label: "脑图", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v4"/>
                  <path d="M12 18v4"/>
                  <path d="M4.93 4.93l2.83 2.83"/>
                  <path d="M16.24 16.24l2.83 2.83"/>
                  <path d="M2 12h4"/>
                  <path d="M18 12h4"/>
                  <path d="M4.93 19.07l2.83-2.83"/>
                  <path d="M16.24 7.76l2.83-2.83"/>
                </svg>
              )},
              { key: "graph", label: "图谱", icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              )},
            ] as { key: EditorMode; label: string; icon: React.ReactNode }[]).map((item) => (
              <button
                key={item.key}
                title={item.label}
                onClick={() => setMode(item.key)}
                className={clsx(
                  "flex items-center justify-center px-2 py-1 transition-colors",
                  mode === item.key
                    ? "bg-accent text-text-on-accent"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                {item.icon}
              </button>
            ))}
          </div>

          {/* MD 导入/导出（弹出菜单） */}
          <div className="relative">
            <ToolbarBtn title="MD 操作" onClick={() => setShowMdMenu(!showMdMenu)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </ToolbarBtn>
            {showMdMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMdMenu(false)} />
                <div
                  className="absolute right-0 top-full mt-1 z-50 min-w-36 rounded-lg py-1 shadow-lg"
                  style={{
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <button
                    onClick={() => { setShowMdMenu(false); handleImportMd(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text-primary hover:bg-bg-tertiary transition-colors text-left"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    导入 .md
                  </button>
                  <button
                    onClick={() => { setShowMdMenu(false); handleExportMd(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text-primary hover:bg-bg-tertiary transition-colors text-left"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    导出 .md
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 标题输入（日志不显示，日期已由 DailyHeader 展示） */}
      {currentNote.note_type !== "daily" && (
        <input
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="标题"
          className="w-full border-none outline-none bg-transparent text-text-primary"
          style={{
            fontSize: "26px",
            fontWeight: 700,
            padding: isMobile ? "16px 12px 8px" : "20px 24px 8px",
            letterSpacing: "-0.3px",
          }}
        />
      )}

      {/* 元数据面板（日志不需要状态、优先级、标签等元数据） */}
      {currentNote.note_type !== "daily" && (
        <div style={{ padding: isMobile ? "0 12px 8px" : "0 24px 8px" }}>
          <MetaPanel />
        </div>
      )}

      {/* 跨日期任务聚合（仅在每日日志中显示） */}
      {currentNote.note_type === "daily" && aggregatedTasks.length > 0 && (
        <div style={{ padding: isMobile ? "0 12px 8px" : "0 24px 8px" }}>
          <div className="text-[12px] font-medium text-text-muted mb-2">
            跨日期任务 ({aggregatedTasks.length})
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {aggregatedTasks.map((task, idx) => (
              <button
                key={`${task.noteId}-${idx}`}
                className="w-full text-left text-[13px] px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2"
                style={{ background: "var(--color-bg-input)" }}
                onClick={() => {
                  const found = notes.find((n) => n.id === task.noteId);
                  if (found) openLinkedNote(found);
                }}
              >
                <span className={`task-marker task-marker-${task.marker.toLowerCase()} flex-shrink-0`}>
                  {task.marker}
                </span>
                <span className="truncate text-text-primary flex-1">{task.taskLine.replace(/^(?:[-*+]\s+)?(?:TODO|DOING|NOW|LATER|WAITING)\s+/, "")}</span>
                <span className="text-[11px] text-text-muted flex-shrink-0 truncate max-w-[120px]" title={task.noteTitle}>
                  {task.noteTitle}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          padding: mode === "split" ? "12px 0 40px" : isMobile ? "12px 12px 40px" : "12px 24px 40px",
          display: "flex",
        }}
      >
        {mode === "split" ? (
          <>
            <div style={{ flex: 1, minWidth: 0, height: "100%", padding: "0 12px 0 24px", overflow: "hidden" }}>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder="开始输入...  支持 Markdown 语法"
                className="w-full h-full resize-none bg-transparent outline-none text-text-primary"
                style={{
                  fontSize: "15px",
                  lineHeight: 1.7,
                  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                  overflowY: "auto",
                }}
                spellCheck={false}
              />
            </div>
            <div
              style={{
                width: 1,
                margin: "8px 0",
                background: "var(--color-border)",
              }}
            />
            <div
              ref={previewRef}
              className="h-full overflow-y-auto markdown-preview text-text-primary"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "0 24px 0 12px",
                fontSize: "15px",
                lineHeight: 1.7,
              }}
              onClick={handlePreviewClick}
              onContextMenu={handlePreviewContextMenu}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </>
        ) : mode === "edit" ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            placeholder="开始输入...  支持 Markdown 语法"
            className="w-full h-full resize-none bg-transparent outline-none text-text-primary"
            style={{
              fontSize: "15px",
              lineHeight: 1.7,
              fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
            }}
            spellCheck={false}
          />
        ) : mode === "wysiwyg" ? (
          <ProseMirrorEditor
            content={content}
            onChange={handleContentChange}
            placeholder="开始输入...  支持 Markdown 语法"
            noteId={currentNote?.id}
            onWikiLinkClick={handleWikiLinkClick}
            notes={[...notes, ...dailyJournals]}
          />
        ) : mode === "mindmap" ? (
          currentNote ? (
            <MindMapView
              note={{ ...currentNote, content: currentNoteContent }}
              onNavigate={handlePreviewClick}
              onContentChange={(newContent) => {
                // 立即保存（不等待防抖），确保脑图编辑即时生效
              setContent(newContent);
              if (currentNote) {
                savingContentRef.current = true;
                updateNoteContent(currentNote.id, title, newContent).finally(() => {
                  savingContentRef.current = false;
                });
              }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted" style={{ fontSize: "14px" }}>
              请选择一篇笔记
            </div>
          )
        ) : mode === "graph" ? (
          <GraphView
            notes={allGraphNotes}
            journals={dailyJournals}
            folders={folders}
            onNodeClick={(noteId) => {
              const found = [...allGraphNotes, ...dailyJournals].find((n) => n.id === noteId);
              if (found) {
                openLinkedNote(found);
              }
            }}
          />
        ) : (
          <div
            ref={previewRef}
            className="w-full h-full overflow-y-auto markdown-preview text-text-primary"
            style={{ fontSize: "15px", lineHeight: 1.7 }}
            onClick={handlePreviewClick}
            onContextMenu={handlePreviewContextMenu}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}

        {/* 反向链接区（仅预览/双栏时显示） */}
        {mode !== "edit" && mode !== "mindmap" && mode !== "graph" && backlinks.length > 0 && (
          <div style={{ padding: "12px 24px", borderTop: "1px solid var(--color-border)", marginTop: "auto" }}>
            <div className="text-[12px] text-text-muted mb-2">
              反向链接 ({backlinks.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {backlinks.map((n) => (
                <button
                  key={n.id}
                  className="text-[12px] px-2 py-1 rounded-md text-text-secondary hover:text-text-primary transition-colors"
                  style={{ background: "var(--color-bg-input)" }}
                  onClick={() => {
                    openLinkedNote(n);
                  }}
                  title={n.title}
                >
                  {n.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 斜杠命令菜单 */}
      {slashMenu?.open && (
        <div
          className="fixed z-[100] bg-bg-primary border border-border rounded-xl shadow-2xl py-1.5 min-w-[220px] max-h-[360px] overflow-y-auto"
          style={{
            left: slashMenu.x,
            top: slashMenu.y,
            boxShadow: "0 16px 48px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          {(() => {
            const filtered = getSlashCommands().filter((c) =>
              c.label.toLowerCase().includes(slashMenu.query.toLowerCase())
            );
            let lastGroup = "";
            return filtered.map((cmd, idx) => {
              const showGroupHeader = cmd.group && cmd.group !== lastGroup;
              lastGroup = cmd.group || "";
              return (
                <div key={idx}>
                  {showGroupHeader && (
                    <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    className={clsx(
                      "w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-[13px] transition-colors",
                      idx === slashMenu.selectedIndex ? "bg-bg-secondary" : "hover:bg-bg-secondary"
                    )}
                    onClick={() => executeSlashCommand(cmd)}
                    onMouseEnter={() => setSlashMenu((s) => (s ? { ...s, selectedIndex: idx } : null))}
                  >
                    <span className="w-5 text-center">{cmd.icon}</span>
                    <span className="font-medium text-text-primary min-w-[48px]">{cmd.label}</span>
                    <span className="text-text-muted text-[11px]">{cmd.desc}</span>
                  </button>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* 块引用右键菜单 */}
      {blockMenu?.open && (
        <div
          className="fixed z-50 bg-bg-primary border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: blockMenu.x, top: blockMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-bg-secondary text-[13px] text-text-primary"
            onClick={() => copyBlockRef(false)}
          >
            复制块引用 ((...))
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-bg-secondary text-[13px] text-text-primary"
            onClick={() => copyBlockRef(true)}
          >
            复制内嵌块 {'{{embed ((...))}}'}
          </button>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteModal && (
        <AppleModal
          open={deleteModal.open}
          title="删除笔记"
          message={`确定要删除 "${deleteModal.noteTitle || "无标题"}" 吗？你可以在回收站中找到它。`}
          mode="confirm"
          tone="danger"
          confirmText="删除"
          onCancel={() => setDeleteModal(null)}
          onConfirm={() => {
            softDeleteNote(deleteModal.noteId);
            setDeleteModal(null);
          }}
        />
      )}

      {/* 新建被引用笔记 */}
      {wikiModal && (
        <AppleModal
          open={wikiModal.open}
          title="新建笔记"
          message={`没有找到 "${wikiModal.title}"。是否创建该笔记？`}
          mode="confirm"
          tone="default"
          confirmText="创建"
          onCancel={() => setWikiModal(null)}
          onConfirm={() => handleCreateLinkedNote(wikiModal.title)}
        />
      )}
    </div>
  );
}

/** ============== 脑图视图（参照 Logseq：思维导图布局） ============== */
function MindMapView({ note, onNavigate, onContentChange }: {
  note: Note; onNavigate: (e: React.MouseEvent | Event) => void; onContentChange: (newContent: string) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // 撤销栈：保存内容历史
  const historyRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const pushHistory = (content: string) => {
    historyRef.current = [...historyRef.current.slice(-20), content];
    setCanUndo(true);
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    onContentChange(prev);
    setCanUndo(historyRef.current.length > 0);
  };

  const tree = buildMindMap(note);

  const NODE_H = 36;
  const NODE_W = 180;
  const H_GAP = 60;
  const V_GAP = 10;

  interface FlatNode {
    node: MindMapNode;
    depth: number;
    x: number;
    y: number;
    parentX: number;
    parentY: number;
    hasParent: boolean;
  }

  const flattenTree = (root: MindMapNode): FlatNode[] => {
    const result: FlatNode[] = [];

    const calcSubtreeHeight = (node: MindMapNode): number => {
      if (node.children.length === 0) return NODE_H;
      const childHeights = node.children.map(calcSubtreeHeight);
      const totalChildHeight = childHeights.reduce((a, b) => a + b, 0) + (node.children.length - 1) * V_GAP;
      return Math.max(NODE_H, totalChildHeight);
    };

    const assignPositions = (node: MindMapNode, depth: number, startX: number, startY: number, parentX: number, parentY: number, hasParent: boolean) => {
      const subtreeHeight = calcSubtreeHeight(node);
      const nodeY = startY + (subtreeHeight - NODE_H) / 2;
      result.push({ node, depth, x: startX, y: nodeY, parentX, parentY, hasParent });

      let currentY = startY;
      node.children.forEach((child) => {
        const childHeight = calcSubtreeHeight(child);
        assignPositions(child, depth + 1, startX + NODE_W + H_GAP, currentY, startX + NODE_W, nodeY + NODE_H / 2, true);
        currentY += childHeight + V_GAP;
      });
    };

    const totalHeight = calcSubtreeHeight(root);
    assignPositions(root, 0, 0, 0, 0, 0, false);
    return result;
  };

  const flatNodes = tree ? flattenTree(tree) : [];

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.min(2, Math.max(0.3, s + delta)));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".mindmap-action-btn")) return;
    if (target.closest(".mindmap-zoom-controls")) return;
    // 点击在节点上不触发拖拽，避免干扰双击编辑
    if (target.closest(".mindmap-node")) return;
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
  };
  const onMouseUp = () => { isPanningRef.current = false; };

  if (!tree) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-text-muted" style={{ fontSize: "14px" }}>
        <div style={{ fontSize: "40px", opacity: 0.3, marginBottom: "12px" }}>🗺️</div>
        <div>当前笔记还没有标题结构</div>
        <div style={{ fontSize: "12px", marginTop: "8px", opacity: 0.7 }}>使用 # 、## 、### 创建标题后，会自动生成脑图</div>
        <button
          onClick={() => onContentChange((note.content || "") + (note.content ? "\n\n" : "") + "# 新标题")}
          style={{ marginTop: "12px", padding: "6px 16px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-bg-input)", cursor: "pointer", color: "var(--color-accent)" }}
        >
          + 新建一个标题段落
        </button>
      </div>
    );
  }

  const totalWidth = flatNodes.reduce((max, n) => Math.max(max, n.x + NODE_W + 56), 0);
  const totalHeight = flatNodes.reduce((max, n) => Math.max(max, n.y + NODE_H + 10), 0);

  return (
    <div
      className="w-full h-full overflow-hidden"
      style={{ cursor: isPanningRef.current ? "grabbing" : "grab", position: "relative" }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div
        style={{
          position: "absolute", right: 12, top: 12,
          display: "flex", flexDirection: "column", gap: "4px",
          zIndex: 100,
        }}
        className="mindmap-zoom-controls"
      >
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          style={{ width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-bg-sidebar)", cursor: canUndo ? "pointer" : "default", fontSize: "14px", color: canUndo ? "var(--color-accent)" : "var(--color-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", opacity: canUndo ? 1 : 0.4 }}
          title="撤销上一步操作"
        >↩</button>
        <button
          onClick={() => setScale((s) => Math.min(2, s + 0.15))}
          style={{ width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-bg-sidebar)", cursor: "pointer", fontSize: "16px", color: "var(--color-text-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >+</button>
        <button
          onClick={() => setScale((s) => Math.max(0.3, s - 0.15))}
          style={{ width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-bg-sidebar)", cursor: "pointer", fontSize: "16px", color: "var(--color-text-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >−</button>
        <button
          onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}
          style={{ width: 28, height: 28, borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-bg-sidebar)", cursor: "pointer", fontSize: "12px", color: "var(--color-text-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >⟲</button>
      </div>

      <div style={{ position: "absolute", left: 12, bottom: 12, fontSize: "11px", color: "var(--color-text-muted)", zIndex: 100 }}>
        滚轮缩放 · 拖拽平移 · 双击标题编辑
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      >
        <div style={{ position: "relative", width: totalWidth, height: totalHeight }}>
          {/* 连线层 */}
          <svg style={{ position: "absolute", top: 0, left: 0, width: totalWidth, height: totalHeight, pointerEvents: "none", zIndex: 0 }}>
            {flatNodes.filter(n => n.hasParent).map((fn) => {
              const id = `line-${fn.node.line}`;
              const sx = fn.parentX;
              const sy = fn.parentY;
              const ex = fn.x;
              const ey = fn.y + NODE_H / 2;
              const mx = (sx + ex) / 2;
              return (
                <g key={id}>
                  <defs>
                    <marker
                      id={`arr-${fn.node.line}`}
                      markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-accent)" opacity="0.5" />
                    </marker>
                  </defs>
                  <path
                    d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`}
                    stroke={fn.depth <= 2 ? "var(--color-accent)" : "var(--color-border-strong)"}
                    strokeWidth={fn.depth <= 1 ? 2 : 1.5}
                    strokeOpacity={fn.depth <= 1 ? 0.5 : 0.3}
                    fill="none"
                    strokeLinecap="round"
                    markerEnd={`url(#arr-${fn.node.line})`}
                  />
                </g>
              );
            })}
          </svg>

          {/* 节点层 */}
          {flatNodes.map((fn) => {
            const { node, depth, x, y } = fn;
            const isEditing = editingId === node.line;
            const isRoot = depth === 0;

            const nodeStyle: React.CSSProperties = {
              position: "relative",
              width: NODE_W,
              height: NODE_H,
              borderRadius: isRoot ? "8px" : "6px",
              border: isRoot ? "none" : "1px solid var(--color-border)",
              background: isRoot
                ? "var(--color-accent)"
                : depth === 1
                  ? "rgba(0,122,255,0.1)"
                  : "var(--color-bg-input)",
              color: isRoot ? "var(--color-text-on-accent)" : "var(--color-text-primary)",
              fontSize: isRoot ? "15px" : depth === 1 ? "14px" : "13px",
              fontWeight: isRoot ? 600 : depth === 1 ? 500 : 400,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 12px",
              cursor: "default",
              userSelect: "none",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              boxShadow: isRoot ? "0 4px 12px rgba(0,122,255,0.3)" : "0 2px 6px rgba(0,0,0,0.08)",
              zIndex: 10,
            };

            const nodeContent = isEditing ? (
              <input
                ref={inputRef}
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  if (editValue.trim()) {
                    handleRename(editValue.trim());
                  }
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (editValue.trim()) handleRename(editValue.trim());
                    setEditingId(null);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%", height: "100%", border: "1px solid var(--color-accent)",
                  borderRadius: "4px", background: "var(--color-bg-empty)",
                  color: "var(--color-text-primary)", fontSize: "13px", padding: "0 10px",
                  textAlign: "center", outline: "none",
                }}
              />
            ) : (
              <div
                onDoubleClick={() => {
                  if (node.line >= 0) {
                    setEditingId(node.line);
                    setEditValue(node.title);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}
                title={node.line >= 0 ? "双击编辑" : node.title}
              >
                {node.title}
              </div>
            );

            const btnStyle = (color: string): React.CSSProperties => ({
              width: 20, height: 20, borderRadius: "50%",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-sidebar)",
              cursor: "pointer", fontSize: "14px",
              color, padding: 0, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              opacity: 0,
              transition: "opacity 120ms",
              zIndex: 20,
            });

            const handleAddChild = () => {
              pushHistory(note.content);
              // 使用 node.level（实际标题层级）而非 depth（树深度），处理标题层级不连续的情况
              const { content: newContent } = addHeadingAfter(note.content, node.line, node.level);
              onContentChange(newContent);
            };
            const handleDelete = () => {
              if (!window.confirm("确定删除此节点及其子内容？")) return;
              pushHistory(note.content);
              // 使用行号直接定位，避免标题/层级匹配可能出现的歧义
              onContentChange(deleteHeading(note.content, node.line));
            };
            const handleRename = (newTitle: string) => {
              pushHistory(note.content);
              // 使用行号直接定位，避免标题/层级匹配可能出现的歧义
              onContentChange(renameHeading(note.content, node.line, newTitle));
            };

            return (
              <div
                key={`${depth}-${node.line}`}
                className="mindmap-node"
                data-node-line={node.line}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: NODE_W + 56,
                  height: NODE_H,
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  const btns = el.querySelectorAll(".mindmap-action-btn");
                  btns.forEach((btn) => (btn as HTMLElement).style.opacity = "1");
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  const btns = el.querySelectorAll(".mindmap-action-btn");
                  btns.forEach((btn) => (btn as HTMLElement).style.opacity = "0");
                }}
              >
                <div style={nodeStyle}>
                  {nodeContent}
                </div>
                {!isRoot && (
                  <div style={{
                    position: "absolute",
                    right: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "flex",
                    gap: "4px",
                  }}>
                    <button
                      className="mindmap-action-btn"
                      onClick={(e) => { e.stopPropagation(); handleAddChild(); }}
                      style={btnStyle("var(--color-accent)")}
                      title="添加子节点"
                    >+</button>
                    <button
                      className="mindmap-action-btn"
                      onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                      style={btnStyle("var(--color-danger)")}
                      title="删除节点"
                    >×</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 工具栏按钮 */
function ToolbarBtn({
  children, title, onClick, danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "w-8 h-8 flex items-center justify-center rounded-md transition-colors",
        "text-[13px] font-semibold",
        danger
          ? "text-text-secondary hover:text-danger hover:bg-bg-sidebar-hover"
          : "text-text-secondary hover:text-text-primary hover:bg-bg-sidebar-hover"
      )}
    >
      {children}
    </button>
  );
}

/** 格式工具栏下拉菜单按钮 */
function DropdownBtn({
  children, title, onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-text-primary hover:bg-bg-tertiary transition-colors text-left"
    >
      {children}
    </button>
  );
}
