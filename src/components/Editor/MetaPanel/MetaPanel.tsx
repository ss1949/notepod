import { useState, useRef, useEffect } from "react";
import { useNotesStore } from "../../../stores/notesStore";
import { priorityLabel, formatTimestamp } from "../../../lib/dateUtils";
import clsx from "clsx";
import type { Folder } from "../../../lib/tauri";

function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}`;
}

function isOverdue(dueDate: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today.getTime();
}

export function MetaPanel() {
  const { currentNote, toggleStatus, setPriority, toggleStarred, togglePinned, setTags, tags, updateNoteTime, folders, updateNoteFolder, setDueDate } =
    useNotesStore();

  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showTimeEditor, setShowTimeEditor] = useState(false);
  const [timeValue, setTimeValue] = useState("");
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);
  const [showDueDateEditor, setShowDueDateEditor] = useState(false);
  const [dueDateValue, setDueDateValue] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const folderDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showFolderDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setShowFolderDropdown(false);
      }
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [showFolderDropdown]);

  if (!currentNote) return null;

  // 构建带层级的文件夹路径，用于展示
  const folderPathMap: Record<string, string> = {};
  (function build(id: string | null, segments: string[]) {
    const children = folders.filter((f) => (f.parent_id ?? null) === id);
    for (const child of children) {
      const path = [...segments, child.name];
      folderPathMap[child.id] = path.join(" / ");
      build(child.id, path);
    }
  })(null, []);

  const currentFolder: Folder | undefined = folders.find((f) => f.id === currentNote.folder_id);
  const priorities = ["high", "medium", "low"];

  const handleMoveToFolder = (folderId: string | null) => {
    if (folderId === currentNote.folder_id) {
      setShowFolderDropdown(false);
      return;
    }
    updateNoteFolder(currentNote.id, folderId);
    setShowFolderDropdown(false);
  };

  const handleAddTag = (tag?: string) => {
    const t = (tag ?? tagInput).trim();
    if (t && !currentNote.tags.includes(t)) {
      setTags(currentNote.id, [...currentNote.tags, t]);
    }
    setTagInput("");
    setShowTagDropdown(false);
    if (!tag) setShowTagInput(false);
  };

  const handleRemoveTag = (tag: string) => {
    setTags(
      currentNote.id,
      currentNote.tags.filter((t) => t !== tag)
    );
  };

  const tagSuggestions = tags
    .map((t) => t.name)
    .filter(
      (name) =>
        !currentNote.tags.includes(name) &&
        (!tagInput || name.toLowerCase().includes(tagInput.toLowerCase()))
    );

  const handleTimeSave = () => {
    if (timeValue) {
      const ts = new Date(timeValue).getTime();
      updateNoteTime(currentNote.id, ts);
    }
    setShowTimeEditor(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      {/* 所属文件夹：带层级路径显示 */}
      <div className="relative" ref={folderDropdownRef}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowFolderDropdown((v) => !v);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium transition-colors hover:opacity-90"
          style={{
            background: "var(--color-bg-input)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}
          title="移动到其他文件夹"
        >
          {currentFolder ? (
            <>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: currentFolder.color }}
              />
              <span className="max-w-[120px] truncate">{folderPathMap[currentFolder.id] || currentFolder.name}</span>
            </>
          ) : (
            <span>无所属文件夹</span>
          )}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {showFolderDropdown && (
          <div
            className="absolute top-full left-0 mt-1 z-50 min-w-48 max-h-64 overflow-y-auto rounded-lg py-1"
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleMoveToFolder(null)}
              className={clsx(
                "block w-full text-left text-[12px] px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary transition-colors flex items-center gap-2",
                !currentNote.folder_id && "bg-bg-sidebar-active text-accent"
              )}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-text-muted)" }} />
              <span className="italic text-text-muted">无所属文件夹</span>
            </button>
            {folders
              .slice()
              .sort((a, b) => {
                const pa = folderPathMap[a.id] || a.name;
                const pb = folderPathMap[b.id] || b.name;
                return pa.localeCompare(pb);
              })
              .map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => handleMoveToFolder(folder.id)}
                  className={clsx(
                    "block w-full text-left text-[12px] px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary transition-colors flex items-center gap-2",
                    currentNote.folder_id === folder.id && "bg-bg-sidebar-active text-accent"
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: folder.color }}
                  />
                  <span className="truncate">{folderPathMap[folder.id] || folder.name}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* 状态切换 - status-toggle 风格 */}
      <button
        onClick={() => toggleStatus(currentNote.id)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium transition-colors"
        style={{
          background: currentNote.status === "done" ? "rgba(52,199,89,0.12)" : "var(--color-bg-input)",
          color: currentNote.status === "done" ? "var(--color-success)" : "var(--color-text-secondary)",
          border: currentNote.status === "done"
            ? "1px solid rgba(52,199,89,0.3)"
            : "1px solid var(--color-border)",
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: currentNote.status === "done" ? "var(--color-success)" : "var(--color-warning)",
          }}
        />
        {currentNote.status === "done" ? "已完成" : "待办"}
      </button>

      {/* 优先级选择 */}
      <div className="flex items-center gap-0.5">
        {priorities.map((p) => (
          <button
            key={p}
            onClick={() => setPriority(currentNote.id, p)}
            className={clsx(
              "text-[11px] px-2 py-0.5 rounded-md transition-colors",
              currentNote.priority === p
                ? "bg-accent text-text-on-accent"
                : "text-text-secondary hover:bg-bg-input"
            )}
          >
            {priorityLabel(p)}
          </button>
        ))}
      </div>

      {/* 加星 */}
      <button
        onClick={() => toggleStarred(currentNote.id, !currentNote.starred)}
        className="w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-bg-input"
        style={{ color: currentNote.starred ? "var(--color-warning)" : "var(--color-text-muted)" }}
        title="加星"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={currentNote.starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>

      {/* 置顶 */}
      <button
        onClick={() => togglePinned(currentNote.id, !currentNote.pinned)}
        className="w-8 h-8 flex items-center justify-center rounded-md transition-colors hover:bg-bg-input"
        style={{ color: currentNote.pinned ? "var(--color-accent)" : "var(--color-text-muted)" }}
        title="置顶"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 17v5"/>
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
        </svg>
      </button>

      {/* 创建时间 */}
      <div className="flex items-center gap-1">
        {showTimeEditor ? (
          <div className="flex items-center gap-1">
            <input
              type="datetime-local"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="text-[11px] px-1.5 py-0.5 rounded-md outline-none"
              style={{
                background: "var(--color-bg-input)",
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-text-primary)",
              }}
            />
            <button
              onClick={handleTimeSave}
              className="text-[11px] px-1.5 py-0.5 rounded-md bg-accent text-text-on-accent hover:bg-accent-hover"
            >
              ✓
            </button>
            <button
              onClick={() => setShowTimeEditor(false)}
              className="text-[11px] px-1.5 py-0.5 rounded-md hover:bg-bg-input text-text-muted"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setTimeValue(toDatetimeLocal(currentNote.created_at));
              setShowTimeEditor(true);
            }}
            className="text-[11px] text-text-muted hover:text-accent transition-colors"
            title="点击修改创建时间"
          >
            {formatTimestamp(currentNote.created_at)}
          </button>
        )}
      </div>

      {/* 截止日期 */}
      <div className="flex items-center gap-1">
        {showDueDateEditor ? (
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dueDateValue}
              onChange={(e) => setDueDateValue(e.target.value)}
              className="text-[11px] px-1.5 py-0.5 rounded-md outline-none"
              style={{
                background: "var(--color-bg-input)",
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-text-primary)",
              }}
            />
            <button
              onClick={() => {
                if (dueDateValue) {
                  const ts = new Date(dueDateValue).getTime();
                  setDueDate(currentNote.id, ts);
                }
                setShowDueDateEditor(false);
              }}
              className="text-[11px] px-1.5 py-0.5 rounded-md bg-accent text-text-on-accent hover:bg-accent-hover"
            >
              ✓
            </button>
            <button
              onClick={() => {
                setDueDate(currentNote.id, null);
                setShowDueDateEditor(false);
              }}
              className="text-[11px] px-1.5 py-0.5 rounded-md hover:bg-bg-input text-text-muted"
              title="清除截止日期"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setDueDateValue(currentNote.due_date ? new Date(currentNote.due_date).toISOString().split("T")[0] : "");
              setShowDueDateEditor(true);
            }}
            className={clsx(
              "text-[11px] px-2 py-0.5 rounded-md transition-colors",
              currentNote.due_date
                ? isOverdue(currentNote.due_date) && currentNote.status !== "done"
                  ? "bg-red-50 dark:bg-red-900/20 text-danger"
                  : "text-accent"
                : "text-text-muted hover:text-accent"
            )}
            title="设置截止日期"
          >
            {currentNote.due_date
              ? `截止: ${new Date(currentNote.due_date).toLocaleDateString()}`
              : "+ 截止日期"}
          </button>
        )}
      </div>

      {/* 标签 */}
      <div className="flex items-center gap-1.5 flex-wrap relative">
        {currentNote.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-xl text-[11px] font-medium"
            style={{
              background: "var(--color-bg-input)",
              color: "var(--color-text-secondary)",
            }}
          >
            {tag}
            <button
              onClick={() => handleRemoveTag(tag)}
              className="text-[13px] leading-none opacity-50 hover:opacity-100 hover:text-danger transition-opacity"
            >
              ×
            </button>
          </span>
        ))}
        {showTagInput ? (
          <div className="relative">
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value);
                setShowTagDropdown(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
                if (e.key === "Escape") {
                  setShowTagInput(false);
                  setShowTagDropdown(false);
                  setTagInput("");
                }
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (tagInput.trim()) handleAddTag();
                  else {
                    setShowTagInput(false);
                    setShowTagDropdown(false);
                  }
                }, 150);
              }}
              onFocus={() => setShowTagDropdown(true)}
              autoFocus
              placeholder="标签名..."
              className="text-[11px] px-2 py-0.5 rounded-md outline-none w-20"
              style={{
                background: "var(--color-bg-input)",
                border: "1px solid var(--color-accent)",
                color: "var(--color-text-primary)",
              }}
            />
            {showTagDropdown && tagSuggestions.length > 0 && (
              <div
                className="absolute top-full left-0 mt-1 z-50 min-w-32 max-h-40 overflow-y-auto rounded-lg py-1"
                style={{
                  background: "var(--color-bg-primary)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                }}
              >
                {tagSuggestions.map((name) => (
                  <button
                    key={name}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddTag(name);
                      tagInputRef.current?.focus();
                    }}
                    className="block w-full text-left text-[12px] px-2.5 py-1.5 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
                  >
                    #{name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="inline-flex items-center gap-0.5 py-0.5 px-2 rounded-xl text-[11px] text-accent transition-colors"
            style={{
              border: "1px dashed var(--color-border-strong)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--color-bg-sidebar-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            + 标签
          </button>
        )}
      </div>
    </div>
  );
}
