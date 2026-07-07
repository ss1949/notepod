import { useState, useEffect, useRef } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { Note } from "../../lib/tauri";
import { useQueryStore } from "../../stores/queryStore";
import { formatTimestamp, priorityColor, priorityLabel, isOverdue, formatDueDate,
  startOfToday, endOfToday, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfLastMonth, endOfLastMonth } from "../../lib/dateUtils";
import { AppleModal } from "../Layout/AppleModal";
import { api } from "../../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";

export function NoteList() {
  const {
    notes, trashNotes, currentNote, selectNote, createNote,
    toggleStatus, togglePinned, toggleStarred,
    softDeleteNote, restoreNote, permanentDeleteNote, emptyTrash,
    filterMode, setFilterMode, tags, openDailyNote, createDailyNote,
    dailyJournals, loadDailyJournals,
  } = useNotesStore();

  const {
    params, setKeyword, setDateRange, setTagIds: setQueryTagIds,
    togglePriority, setPriorities, setStatus, setNoteType, setStarredOnly,
    resetParams, executeQuery, results, querying,
  } = useQueryStore();

  const [searchText, setSearchText] = useState("");

  // 删除确认弹窗
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    noteId: string;
    noteTitle: string;
    mode: "soft" | "permanent";
  } | null>(null);

  // ===== 查询状态 =====

  const [customDateFrom, setCustomDateFrom] = useState("");
  const [customDateTo, setCustomDateTo] = useState("");
  // 当前选中的日期快捷按钮（只高亮一个）
  const [activeDatePreset, setActiveDatePreset] = useState<string | null>(null);
  const [queryInitialized, setQueryInitialized] = useState(false);

  const isTrash = filterMode === "trash";
  const isQuery = filterMode === "query";
  const isDaily = filterMode === "daily";
  const isGraph = filterMode === "graph";
  const dataSource = isTrash ? trashNotes : notes;

  // 加载已有日志列表
  useEffect(() => {
    if (isDaily) {
      loadDailyJournals();
    }
  }, [isDaily, loadDailyJournals]);

  // 普通模式：客户端筛选
  const filteredNotes = dataSource.filter((n) => {
    if (filterMode === "daily") return false;
    if (filterMode === "starred") return n.starred;
    if (filterMode === "todo") return n.status === "todo";
    return true;
  });

  // 搜索过滤（仅标题搜索，content 按需加载不在列表中）
  const displayNotes = !isQuery && searchText.trim()
    ? filteredNotes.filter((n) =>
        n.title.toLowerCase().includes(searchText.toLowerCase())
      )
    : filteredNotes;

  const pinnedNotes = displayNotes.filter((n) => n.pinned);
  const normalNotes = displayNotes.filter((n) => !n.pinned);

  const listTitle =
    filterMode === "starred" ? "已加星" :
    filterMode === "todo" ? "待办" :
    filterMode === "trash" ? "回收站" :
    filterMode === "query" ? "高级查询" :
    filterMode === "daily" ? "每日日志" :
    filterMode === "graph" ? "关系图谱" :
    "所有笔记";

  const handleConfirmDelete = () => {
    if (!deleteModal) return;
    if (deleteModal.mode === "soft") {
      softDeleteNote(deleteModal.noteId);
    } else {
      if (!deleteModal.noteId) {
        emptyTrash();
      } else {
        permanentDeleteNote(deleteModal.noteId);
      }
    }
    setDeleteModal(null);
  };

  // ===== 自动查询（防抖 300ms） =====

  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerQuery = () => {
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    queryTimerRef.current = setTimeout(() => {
      // 查询时重置编辑区（清除当前选中的笔记）
      selectNote(null);
      executeQuery();
    }, 300);
  };

  // 进入 query 模式时自动查询
  useEffect(() => {
    if (isQuery) {
      triggerQuery();
      setQueryInitialized(true);
    }
    return () => { if (queryTimerRef.current) clearTimeout(queryTimerRef.current); };
  }, [isQuery]);

  // params 条件变化时自动查询（排除初始化时的空查询）
  useEffect(() => {
    if (isQuery && queryInitialized) triggerQuery();
  }, [
    params.keyword, params.date_from, params.date_to,
    params.tag_ids, params.priorities, params.status, params.note_type, params.starred_only,
  ]);

  const handleReset = () => {
    resetParams();           // 清空 queryStore 的 params 和 results
    setCustomDateFrom("");
    setCustomDateTo("");
    setActiveDatePreset(null);
    // 重置后重新执行空查询（显示全部笔记），留在查询页面
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    queryTimerRef.current = setTimeout(() => {
      selectNote(null);
      executeQuery();
    }, 100);
  };

  const handleExportCsv = async () => {
    try {
      const filePath = await save({
        defaultPath: `查询结果_${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (filePath) {
        const count = await api.exportCsv(params, filePath);
        alert(`导出成功！共 ${count} 条记录`);
      }
    } catch (e) {
      console.error("Export CSV failed:", e);
    }
  };

  // 导入 MD 文件
  const [importing, setImporting] = useState(false);
  const handleImportMd = async () => {
    try {
      const filePath = await open({
        multiple: true,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (!filePath) return;
      const files = Array.isArray(filePath) ? filePath : [filePath];
      setImporting(true);
      let successCount = 0;
      for (const f of files) {
        try {
          await api.importNoteFromMd(f);
          successCount++;
        } catch (e) {
          console.error(`导入失败: ${f}`, e);
        }
      }
      await useNotesStore.getState().loadNotes();
      if (successCount > 0) {
        alert(`成功导入 ${successCount} 篇笔记`);
      }
    } catch (e) {
      console.error("Import MD failed:", e);
    } finally {
      setImporting(false);
    }
  };

  // 选择日期快捷按钮
  const applyDatePreset = (label: string) => {
    let from: number | undefined;
    let to: number | undefined;
    switch (label) {
      case "today": from = startOfToday(); to = endOfToday(); break;
      case "week": from = startOfWeek(); to = endOfWeek(); break;
      case "month": from = startOfMonth(); to = endOfMonth(); break;
      case "lastMonth": from = startOfLastMonth(); to = endOfLastMonth(); break;
    }
    setActiveDatePreset(label);
    setDateRange(from, to);
    // 同时更新自定义日期显示
    if (from) setCustomDateFrom(new Date(from).toISOString().slice(0, 10));
    else setCustomDateFrom("");
    if (to) setCustomDateTo(new Date(to).toISOString().slice(0, 10));
    else setCustomDateTo("");
    // 直接触发查询（重置编辑器）
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    selectNote(null);
    queryTimerRef.current = setTimeout(() => executeQuery(), 200);
  };

  // 自定义日期变更
  const handleCustomDateFrom = (value: string) => {
    setCustomDateFrom(value);
    setActiveDatePreset(null);
    const from = value ? new Date(value + "T00:00:00").getTime() : undefined;
    setDateRange(from, params.date_to);
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    selectNote(null);
    queryTimerRef.current = setTimeout(() => executeQuery(), 200);
  };

  const handleCustomDateTo = (value: string) => {
    setCustomDateTo(value);
    setActiveDatePreset(null);
    const to = value ? new Date(value + "T23:59:59").getTime() : undefined;
    setDateRange(params.date_from, to);
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    selectNote(null);
    queryTimerRef.current = setTimeout(() => executeQuery(), 200);
  };

  const clearDateFilter = () => {
    setActiveDatePreset(null);
    setDateRange(undefined, undefined);
    setCustomDateFrom("");
    setCustomDateTo("");
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    selectNote(null);
    queryTimerRef.current = setTimeout(() => executeQuery(), 200);
  };

  const hasDateFilter = !!(params.date_from || params.date_to);
  const hasQueryParams = !!(params.keyword || hasDateFilter ||
    params.tag_ids.length > 0 || params.priorities.length > 0 ||
    params.status || params.starred_only);

  // ===== NoteCard 渲染 =====

  const renderNotes = (notesList: typeof notes) => (
    notesList.map((note) => (
      <NoteCard
        key={note.id}
        note={note}
        active={currentNote?.id === note.id}
        isTrash={isTrash}
        onClick={() => selectNote(note)}
        onToggleStatus={() => toggleStatus(note.id)}
        onTogglePinned={() => togglePinned(note.id, !note.pinned)}
        onToggleStarred={() => toggleStarred(note.id, !note.starred)}
        onDelete={() =>
          setDeleteModal({ open: true, noteId: note.id, noteTitle: note.title, mode: isTrash ? "permanent" : "soft" })
        }
        onRestore={() => restoreNote(note.id)}
      />
    ))
  );

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
      <div style={{ padding: "14px 14px 10px" }}>
        {/* 标题行 */}
        <div className="flex items-center justify-between" style={{ marginBottom: "10px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.2px" }} className="text-text-primary">
            {listTitle}
          </h2>
          {isTrash ? (
            trashNotes.length > 0 && (
              <button
                onClick={() => setDeleteModal({ open: true, noteId: "", noteTitle: "回收站中所有笔记", mode: "permanent" })}
                className="px-2.5 h-7 text-[12px] font-semibold rounded-md text-danger hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                清空
              </button>
            )
          ) : isQuery ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleReset}
                className="px-2.5 h-7 text-[12px] font-semibold rounded-md text-text-secondary hover:bg-bg-tertiary transition-colors"
              >
                重置
              </button>
              <button
                onClick={handleExportCsv}
                disabled={results.length === 0}
                className="px-2.5 h-7 text-[12px] font-semibold rounded-md text-text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                导出 CSV
              </button>
            </div>
          ) : isDaily ? (
            <button
              onClick={() => createDailyNote()}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-on-accent bg-accent hover:bg-accent-hover transition-colors"
              title="创建日志"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleImportMd}
                disabled={importing}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
                title="导入 Markdown 文件"
              >
                {importing ? (
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                )}
              </button>
              <button
                onClick={createNote}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-on-accent bg-accent hover:bg-accent-hover transition-colors"
                title="新建笔记 (Ctrl+N)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* 搜索框（非 query/trash/graph 模式） */}
        {!isTrash && !isQuery && !isGraph && (
          <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5" style={{ background: "var(--color-bg-input)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted flex-shrink-0">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索笔记..."
              className="flex-1 border-none outline-none bg-transparent text-[13px] text-text-primary placeholder:text-text-muted"
              autoComplete="off"
            />
          </div>
        )}

        {/* ===== 高级查询条件区（Apple 简约标签风格） ===== */}
        {isQuery && (
          <div className="mt-2 space-y-3 border border-border rounded-xl p-3" style={{ background: "var(--color-bg-secondary)" }}>
            {/* 关键词 */}
            <input
              type="text"
              value={params.keyword || ""}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="标题关键词..."
              className="w-full text-[13px] px-3 py-2 rounded-lg border border-border bg-bg-primary outline-none focus:border-accent text-text-primary placeholder:text-text-muted"
            />

            {/* 日期范围 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                {[
                  { label: "今天", value: "today" },
                  { label: "本周", value: "week" },
                  { label: "本月", value: "month" },
                  { label: "上月", value: "lastMonth" },
                ].map((btn) => (
                  <button
                    key={btn.value}
                    onClick={() => applyDatePreset(btn.value)}
                    className={clsx(
                      "px-3 py-1 text-[11px] rounded-full font-medium transition-colors",
                      activeDatePreset === btn.value
                        ? "bg-accent text-white"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                    )}
                  >
                    {btn.label}
                  </button>
                ))}
                <button
                  onClick={clearDateFilter}
                  className="px-3 py-1 text-[11px] rounded-full font-medium bg-bg-primary text-text-muted hover:text-text-primary border border-border transition-colors"
                >
                  清除
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customDateFrom}
                  onChange={(e) => handleCustomDateFrom(e.target.value)}
                  className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-border bg-bg-primary outline-none focus:border-accent"
                />
                <span className="text-[11px] text-text-muted">~</span>
                <input
                  type="date"
                  value={customDateTo}
                  onChange={(e) => handleCustomDateTo(e.target.value)}
                  className="flex-1 text-[12px] px-2 py-1.5 rounded-lg border border-border bg-bg-primary outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* 标签 */}
            {tags.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-text-muted w-10 flex-shrink-0 pt-1">标签</span>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {tags.map((tag) => {
                    const selected = params.tag_ids.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => {
                          const newIds = selected
                            ? params.tag_ids.filter((id) => id !== tag.id)
                            : [...params.tag_ids, tag.id];
                          setQueryTagIds(newIds);
                        }}
                        className={clsx(
                          "px-2.5 py-1 text-[11px] rounded-full font-medium transition-colors",
                          selected ? "text-white" : "text-text-secondary border border-border hover:bg-bg-tertiary"
                        )}
                        style={selected ? { backgroundColor: tag.color } : undefined}
                      >
                        #{tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 优先级 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-text-muted w-10 flex-shrink-0">优先级</span>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "全部", value: undefined, color: undefined },
                  { label: "高", value: "high", color: "#e74c3c" },
                  { label: "中", value: "medium", color: "#f39c12" },
                  { label: "低", value: "low", color: "#95a5a6" },
                ].map((p) => {
                  const active = p.value ? params.priorities.includes(p.value) : params.priorities.length === 0;
                  return (
                    <button
                      key={p.label}
                      onClick={() => {
                        if (!p.value) {
                          setPriorities([]);
                        } else {
                          togglePriority(p.value);
                        }
                      }}
                      className={clsx(
                        "px-3 py-1 text-[11px] rounded-full font-medium transition-colors flex items-center gap-1.5",
                        active
                          ? "bg-accent text-white"
                          : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                      )}
                    >
                      {p.color && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 状态 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-text-muted w-10 flex-shrink-0">状态</span>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "全部", value: undefined },
                  { label: "待办", value: "todo" },
                  { label: "已办", value: "done" },
                ].map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setStatus(s.value)}
                    className={clsx(
                      "px-3 py-1 text-[11px] rounded-full font-medium transition-colors",
                      params.status === s.value || (s.value === undefined && !params.status)
                        ? "bg-accent text-white"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 类型 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-text-muted w-10 flex-shrink-0">类型</span>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "全部", value: undefined },
                  { label: "笔记", value: "note" },
                  { label: "日志", value: "daily" },
                ].map((t) => (
                  <button
                    key={t.label}
                    onClick={() => setNoteType(t.value)}
                    className={clsx(
                      "px-3 py-1 text-[11px] rounded-full font-medium transition-colors",
                      params.note_type === t.value || (t.value === undefined && !params.note_type)
                        ? "bg-accent text-white"
                        : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 仅加星 */}
            <div>
              <button
                onClick={() => setStarredOnly(!params.starred_only)}
                className={clsx(
                  "px-3 py-1 text-[11px] rounded-full font-medium transition-colors flex items-center gap-1.5",
                  params.starred_only
                    ? "bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 border border-yellow-400/40"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                )}
              >
                <span>⭐</span>
                仅加星笔记
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 笔记列表 / 查询结果 */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
        {isGraph ? null : isDaily ? (
          <>
            {dailyJournals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 py-10">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span className="text-[13px]">暂无历史日志</span>
                <span className="text-[12px]">使用 ◀ ▶ 导航到任意日期创建日志</span>
                <button
                  onClick={() => createDailyNote()}
                  className="mt-1 px-4 py-2 rounded-lg text-xs font-medium text-white transition-colors hover:opacity-90 active:scale-95"
                  style={{ background: "var(--accent, #007AFF)" }}
                >
                  创建日志
                </button>
              </div>
            ) : (
              <>
                <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-3 py-2">历史日志</div>
                {dailyJournals.map((d) => {
                  const active = currentNote?.id === d.id;
                  return (
                  <div
                    key={d.id}
                    onClick={() => openDailyNote(d.journal_date!)}
                    className={clsx(
                      "daily-journal-item cursor-pointer transition-colors group px-3 py-2.5 rounded-md",
                      active ? "bg-bg-card-active" : "hover:bg-bg-card-hover"
                    )}
                    style={{
                      marginBottom: "1px",
                      border: active
                        ? "1px solid var(--color-accent)"
                        : "1px solid transparent",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-text-primary">
                        {d.journal_date}
                      </span>
                      <span className="text-[11px] text-text-muted opacity-60">
                        {d.title || "无标题"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteModal({ open: true, noteId: d.id, noteTitle: d.title || d.journal_date!, mode: "soft" });
                        }}
                        className="delete-btn hidden group-hover:flex flex-shrink-0 w-4 h-4 items-center justify-center rounded-sm text-text-muted hover:text-danger hover:scale-125 transition-all opacity-60 hover:opacity-100 ml-2"
                        title="删除日志"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5 truncate">
                      {d.title || "空日志"}
                    </div>
                  </div>
                )})}
              </>
            )}
          </>
        ) : isQuery ? (
          <>
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2 py-10">
                {hasQueryParams && !querying ? (
                  <>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <span className="text-[13px]">没有找到匹配的笔记</span>
                    <span className="text-[12px]">尝试调整查询条件</span>
                  </>
                ) : !hasQueryParams ? (
                  <>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
                    </svg>
                    <span className="text-[13px]">选择条件后将自动查询</span>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[11px] text-text-muted px-3 py-1.5">
                <span>查询结果 — 共 {results.length} 条</span>
              </div>
            )}
            {/* 查询结果渲染为 NoteCard */}
            {results.map((row) => (
              <NoteCard
                key={row.id}
                note={{
                  id: row.id,
                  title: row.title,
                  content: row.content_preview || "",
                  folder_id: null,
                  status: row.status,
                  priority: row.priority,
                  starred: row.starred,
                  pinned: row.pinned,
                  is_encrypted: false,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                  deleted_at: null,
                  tags: row.tags,
                  due_date: null,
                  reminder: null,
                  parent_task_id: null,
                }}
                active={currentNote?.id === row.id}
                isTrash={false}
                onClick={async () => {
                  // 从查询结果中点击打开笔记，优先从本地查找，否则从 API 获取
                  let target = notes.find((n) => n.id === row.id) ?? dailyJournals.find((n) => n.id === row.id);
                  if (!target) {
                    try {
                      target = await api.getNote(row.id);
                    } catch (e) {
                      console.error("Failed to load note:", e);
                      return;
                    }
                  }
                  if (!target) return;
                  selectNote(target);
                }}
                onToggleStatus={() => toggleStatus(row.id)}
                onTogglePinned={() => togglePinned(row.id, !row.pinned)}
                onToggleStarred={() => toggleStarred(row.id, !row.starred)}
                onDelete={() =>
                  setDeleteModal({ open: true, noteId: row.id, noteTitle: row.title, mode: "soft" })
                }
                onRestore={() => {}}
              />
            ))}
          </>
        ) : displayNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2 py-10">
            {isTrash ? (
              <>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                </svg>
                <span className="text-[13px]">回收站为空</span>
              </>
            ) : (
              <>
                <span className="text-[13px]">暂无笔记</span>
                <span className="text-[12px]">点击 + 创建新笔记</span>
              </>
            )}
          </div>
        ) : (
          <>
            {!isTrash && pinnedNotes.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-3 py-2">置顶</div>
                {renderNotes(pinnedNotes)}
              </>
            )}
            {renderNotes(normalNotes)}
          </>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteModal && (
        <AppleModal
          open={deleteModal.open}
          title={deleteModal.mode === "permanent" ? "永久删除" : "删除笔记"}
          message={`确定要删除 "${deleteModal.noteTitle}" 吗？${deleteModal.mode === "permanent" ? "此操作不可恢复。" : "你可以在回收站中找到它。"}`}
          mode="confirm"
          tone="danger"
          confirmText={deleteModal.mode === "permanent" ? "永久删除" : "删除"}
          onCancel={() => setDeleteModal(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

// ===== NoteCard 组件 =====

interface NoteCardProps {
  note: {
    id: string;
    title: string;
    content?: string;
    folder_id?: string | null;
    is_encrypted?: boolean;
    deleted_at?: number | null;
    reminder?: number | null;
    parent_task_id?: string | null;
    status: string;
    priority: string;
    starred: boolean;
    pinned: boolean;
    created_at: number;
    updated_at: number;
    tags: string[];
    due_date: number | null;
  };
  active: boolean;
  isTrash?: boolean;
  onClick: () => void;
  onToggleStatus: () => void;
  onTogglePinned: () => void;
  onToggleStarred: () => void;
  onDelete: () => void;
  onRestore: () => void;
}

function NoteCard({
  note, active, isTrash = false, onClick,
  onToggleStatus, onTogglePinned, onToggleStarred,
  onDelete, onRestore,
}: NoteCardProps) {
  return (
    <div
      onClick={onClick}
      className="note-list-item cursor-pointer transition-colors group relative"
      style={{
        padding: "10px 12px 10px 10px",
        marginBottom: "2px",
        borderRadius: "var(--radius-sm)",
        background: active ? "var(--color-bg-card-active)" : undefined,
        border: active
          ? "1px solid var(--color-accent)"
          : "1px solid transparent",
        opacity: isTrash ? 0.65 : 1,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = "var(--color-bg-card-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = "";
      }}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-[2px]">
          <button
            onClick={(e) => { e.stopPropagation(); if (!isTrash) onToggleStarred(); }}
            className={clsx(
              "w-4 h-4 flex items-center justify-center rounded-sm transition-all hover:scale-110",
              note.starred ? "opacity-100" : "opacity-40 hover:opacity-80",
              isTrash && "pointer-events-none opacity-30"
            )}
            title={note.starred ? "取消星标" : "加星标"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={note.starred ? "var(--color-warning)" : "none"} stroke={note.starred ? "var(--color-warning)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (!isTrash) onTogglePinned(); }}
            className={clsx(
              "w-4 h-4 flex items-center justify-center rounded-sm transition-all hover:scale-110",
              note.pinned ? "opacity-100" : "opacity-40 hover:opacity-80",
              isTrash && "pointer-events-none opacity-30"
            )}
            title={note.pinned ? "取消置顶" : "置顶"}
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24"
              fill={note.pinned ? "var(--color-accent)" : "none"}
              stroke={note.pinned ? "var(--color-accent)" : "currentColor"}
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              className="text-text-muted"
              style={{ transform: "rotate(-45deg)" }}
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 9V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5.76z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[13px] font-semibold truncate flex-1 text-text-primary">
              {note.title || "无标题"}
            </span>
            {isTrash ? (
              <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onRestore(); }}
                  className="text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-sidebar-hover px-1.5 py-0.5 rounded transition-colors"
                >
                  恢复
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-[11px] text-text-muted hover:text-danger hover:bg-red-50 dark:hover:bg-red-900/20 px-1.5 py-0.5 rounded transition-colors"
                >
                  删除
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
                  className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:scale-125 transition-transform"
                  title={note.status === "done" ? "标记为待办" : "标记为已完成"}
                >
                  {note.status === "done" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full border border-text-muted" />
                  )}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="delete-btn hidden group-hover:flex flex-shrink-0 w-4 h-4 items-center justify-center rounded-sm text-text-muted hover:text-danger hover:scale-125 transition-all opacity-60 hover:opacity-100"
                  title="删除笔记"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </>
            )}
          </div>

          <div
            className="text-[12px] text-text-secondary mb-1"
            style={{
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {note.title || "空笔记"}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-text-muted flex-wrap">
            <span>{formatTimestamp(note.updated_at)}</span>
            {!isTrash && note.priority !== "medium" && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: priorityColor(note.priority) + "20", color: priorityColor(note.priority) }}
              >
                {priorityLabel(note.priority)}
              </span>
            )}
            {!isTrash && note.due_date && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: isOverdue(note.due_date, note.status) ? "rgba(255, 59, 48, 0.15)" : "rgba(0, 122, 255, 0.15)",
                  color: isOverdue(note.due_date, note.status) ? "var(--color-danger)" : "var(--color-accent)",
                }}
              >
                📅 {formatDueDate(note.due_date)}{isOverdue(note.due_date, note.status) && " · 已逾期"}
              </span>
            )}
            {note.tags.length > 0 && (
              <span className="truncate">{note.tags.map((t) => `#${t}`).join(" ")}</span>
            )}
            {isTrash && <span className="text-danger">· 已删除</span>}
            <span className="ml-auto flex-shrink-0">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: priorityColor(note.priority) }} title={priorityLabel(note.priority)} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
