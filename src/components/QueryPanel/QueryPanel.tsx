import { useEffect, useState } from "react";
import { useQueryStore } from "../../stores/queryStore";
import { useNotesStore } from "../../stores/notesStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { api, QueryParams, Note } from "../../lib/tauri";
import {
  startOfToday, endOfToday,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  startOfLastMonth, endOfLastMonth,
  formatTimestamp, priorityColor, priorityLabel, statusLabel,
} from "../../lib/dateUtils";
import { save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";

export function QueryPanel() {
  const isMobile = useIsMobile();
  const {
    params, results, showQueryPanel, querying,
    setKeyword, setDateRange, setTagIds, togglePriority,
    setStatus, setNoteType, setStarredOnly, toggleQueryPanel, resetParams, executeQuery,
  } = useQueryStore();
  const { tags } = useNotesStore();

  // 内嵌笔记查看
  const [detailNote, setDetailNote] = useState<Note | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (showQueryPanel && results.length === 0) {
      executeQuery();
    }
  }, [showQueryPanel]);

  if (!showQueryPanel) return null;

  const handleRowClick = async (row: typeof results[0]) => {
    setDetailLoading(true);
    try {
      const note = await api.getNote(row.id);
      setDetailNote(note);
    } catch (e) {
      console.error("Failed to open note:", e);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleBack = () => {
    setDetailNote(null);
  };

  const handleExportCsv = async () => {
    try {
      const filePath = await save({
        defaultPath: `notepod-export-${Date.now()}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (filePath) {
        const count = await api.exportCsv(params as QueryParams, filePath);
        alert(`导出成功！共 ${count} 条记录`);
      }
    } catch (e) {
      alert("导出失败: " + e);
    }
  };

  const dateButtons = [
    { label: "今天", from: startOfToday(), to: endOfToday() },
    { label: "本周", from: startOfWeek(), to: endOfWeek() },
    { label: "本月", from: startOfMonth(), to: endOfMonth() },
    { label: "上个月", from: startOfLastMonth(), to: endOfLastMonth() },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/30" onClick={toggleQueryPanel}>
      <div
        className="bg-bg-primary rounded-lg shadow-2xl flex flex-col"
        style={{ width: isMobile ? "100vw" : "90%", maxWidth: isMobile ? "100%" : "64rem", maxHeight: isMobile ? "100vh" : "75vh", height: isMobile ? "100vh" : "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {detailNote && (
              <button onClick={handleBack} className="text-accent hover:text-accent-hover text-sm font-medium">
                ← 返回
              </button>
            )}
            <span className="text-base font-medium">🔍 高级查询</span>
          </div>
          <button onClick={toggleQueryPanel} className="text-text-muted hover:text-text-primary text-lg">
            ×
          </button>
        </div>

        {/* 筛选区 */}
        <div className="px-5 py-3 space-y-3 border-b border-border overflow-y-auto">
          {/* 关键词 */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted w-20 flex-shrink-0">标题关键词</span>
            <input
              type="text"
              value={params.keyword || ""}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") executeQuery(); }}
              placeholder="输入关键词搜索..."
              className="flex-1 text-sm px-3 py-1.5 rounded border border-border bg-bg-primary outline-none focus:border-accent"
            />
          </div>

          {/* 日期范围 */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted w-20 flex-shrink-0">日期范围</span>
            <div className="flex gap-1.5">
              {dateButtons.map((btn) => (
                <button
                  key={btn.label}
                  onClick={() => setDateRange(btn.from, btn.to)}
                  className={clsx(
                    "text-xs px-3 py-1 rounded-full border transition-colors",
                    params.date_from === btn.from
                      ? "bg-accent text-white border-accent"
                      : "border-border hover:bg-bg-tertiary"
                  )}
                >
                  {btn.label}
                </button>
              ))}
              <button
                onClick={() => setDateRange(undefined, undefined)}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-bg-tertiary"
              >
                清除
              </button>
            </div>
          </div>

          {/* 标签 */}
          {tags.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-text-muted w-20 flex-shrink-0">标签</span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      const current = params.tag_ids;
                      setTagIds(
                        current.includes(tag.id)
                          ? current.filter((t) => t !== tag.id)
                          : [...current, tag.id]
                      );
                    }}
                    className={clsx(
                      "text-xs px-2 py-0.5 rounded-full border transition-colors",
                      params.tag_ids.includes(tag.id)
                        ? "bg-accent text-white border-accent"
                        : "border-border hover:bg-bg-tertiary"
                    )}
                  >
                    #{tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 优先级 + 状态 + 加星 */}
          <div className={`flex ${isMobile ? "flex-col gap-2" : "items-center gap-6"}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">优先级</span>
              {["high", "medium", "low"].map((p) => (
                <label key={p} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={params.priorities.includes(p)}
                    onChange={() => togglePriority(p)}
                    className="custom-checkbox"
                  />
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: priorityColor(p) }}
                  />
                  <span className="text-xs">{priorityLabel(p)}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-sm text-text-muted">状态</span>
              {[
                { value: undefined, label: "全部" },
                { value: "todo", label: "待办" },
                { value: "done", label: "已办" },
              ].map((s) => (
                <button
                  key={s.label}
                  onClick={() => setStatus(s.value)}
                  className={clsx(
                    "px-2.5 py-1 text-xs rounded-full font-medium transition-colors",
                    params.status === s.value || (s.value === undefined && !params.status)
                      ? "bg-accent text-white"
                      : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-sm text-text-muted">类型</span>
              {[
                { value: undefined, label: "全部" },
                { value: "note", label: "笔记" },
                { value: "daily", label: "日志" },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => setNoteType(t.value)}
                  className={clsx(
                    "px-2.5 py-1 text-xs rounded-full font-medium transition-colors",
                    params.note_type === t.value || (t.value === undefined && !params.note_type)
                      ? "bg-accent text-white"
                      : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStarredOnly(!params.starred_only)}
              className={clsx(
                "px-2.5 py-1 text-xs rounded-full font-medium transition-colors flex items-center gap-1",
                params.starred_only
                  ? "bg-yellow-400/20 text-yellow-600 dark:text-yellow-400 border border-yellow-400/40"
                  : "bg-bg-primary text-text-secondary hover:bg-bg-tertiary border border-border"
              )}
            >
              <span>⭐</span>
              仅加星
            </button>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-between px-5 py-2 border-b border-border">
          <button
            onClick={() => { resetParams(); executeQuery(); }}
            className="text-xs px-3 py-1 rounded border border-border hover:bg-bg-tertiary"
          >
            重置
          </button>
          <div className="flex gap-2">
            <button
              onClick={executeQuery}
              disabled={querying}
              className="text-xs px-4 py-1 rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {querying ? "查询中..." : "🔍 查询"}
            </button>
            <button
              onClick={handleExportCsv}
              disabled={results.length === 0}
              className="text-xs px-3 py-1 rounded border border-border hover:bg-bg-tertiary disabled:opacity-50"
            >
              ↓ 导出CSV
            </button>
          </div>
        </div>

        {/* 结果区域：列表 / 详情 */}
        <div className="flex-1 overflow-auto">
          {detailLoading ? (
            <div className="flex items-center justify-center h-32 text-text-muted text-sm">
              加载中...
            </div>
          ) : detailNote ? (
            <div className="px-5 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                  {detailNote.note_type === "daily" ? "日志" : "笔记"}
                </span>
                {detailNote.starred && <span className="text-xs">⭐</span>}
                {detailNote.pinned && <span className="text-xs">📌</span>}
              </div>
              <h2 className="text-lg font-semibold text-text-primary">{detailNote.title || "无标题"}</h2>
              <div className="flex flex-wrap gap-3 text-xs text-text-muted">
                <span>状态: {detailNote.status === "done" ? "✅ 已办" : "🔲 待办"}</span>
                <span>优先级: {priorityLabel(detailNote.priority)}</span>
                <span>创建: {formatTimestamp(detailNote.created_at)}</span>
                <span>更新: {formatTimestamp(detailNote.updated_at)}</span>
              </div>
              {detailNote.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detailNote.tags.map((t) => (
                    <span key={t} className="text-xs text-accent">#{t}</span>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-3">
                <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans leading-relaxed">
                  {detailNote.content || "(空内容)"}
                </pre>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-2 text-xs text-text-muted border-b border-border">
                查询结果 共 {results.length} 条
              </div>
              {results.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                  暂无匹配结果
                </div>
              ) : (
                <div style={{ overflowX: isMobile ? "auto" : undefined }}>
                <table className="w-full text-sm" style={{ minWidth: isMobile ? "600px" : undefined }}>
                  <thead className="sticky top-0 bg-bg-secondary">
                    <tr className="text-left text-xs text-text-muted">
                      <th className="px-3 py-2">标题</th>
                      <th className="px-3 py-2">内容摘要</th>
                      <th className="px-3 py-2">标签</th>
                      <th className="px-3 py-2">优先级</th>
                      <th className="px-3 py-2">状态</th>
                      <th className="px-3 py-2">类型</th>
                      <th className="px-3 py-2">创建时间</th>
                      <th className="px-3 py-2">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr key={row.id} className="border-t border-border hover:bg-bg-secondary cursor-pointer" onClick={() => handleRowClick(row)}>
                        <td className="px-3 py-2 font-medium text-text-primary">
                          {row.pinned && "📌 "}{row.starred && "⭐ "}{row.title || "无标题"}
                        </td>
                        <td className="px-3 py-2 text-text-muted max-w-[200px] truncate">
                          {row.content_preview}
                        </td>
                        <td className="px-3 py-2">
                          {row.tags.map((t) => (
                            <span key={t} className="text-xs text-accent mr-1">#{t}</span>
                          ))}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: priorityColor(row.priority) }} />
                            <span className="text-xs">{priorityLabel(row.priority)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={clsx("text-xs", row.status === "done" ? "text-green-500" : "text-text-muted")}>
                            {row.status === "done" ? "✅" : "🔲"} {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                            {row.note_type === "daily" ? "日志" : "笔记"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-text-muted">{formatTimestamp(row.created_at)}</td>
                        <td className="px-3 py-2 text-xs text-text-muted">{formatTimestamp(row.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
