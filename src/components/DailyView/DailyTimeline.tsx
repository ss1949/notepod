import { useMemo, useState } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { formatTimestamp } from "../../lib/dateUtils";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const TASK_PATTERN = /^((?:\s*[-*+]\s+)?)(TODO|DOING|NOW|LATER|WAITING|DONE|CANCELLED)\s+(.+)$/;

interface TimelineTask {
  marker: string;
  text: string;
}

function parseTasks(content: string): TimelineTask[] {
  const tasks: TimelineTask[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(TASK_PATTERN);
    if (m) {
      tasks.push({ marker: m[2], text: m[3].replace(/\s*(?:started::|finished::|elapsed::|deadline::|scheduled::).*/g, "").trim() });
    }
  }
  return tasks;
}

function getPreview(content: string): string {
  const lines = content.split("\n").filter((l) => {
    const trimmed = l.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```");
  });
  return lines.slice(0, 5).join("\n").substring(0, 300);
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAYS[d.getDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
}

function getRelativeLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (dateStr === todayStr) return "今天";
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 1) return "昨天";
  if (diff === -1) return "明天";
  if (diff > 1 && diff <= 7) return `${diff}天前`;
  if (diff < -1 && diff >= -7) return `${-diff}天后`;
  return "";
}

const MARKER_COLORS: Record<string, string> = {
  TODO: "#8E8E93",
  DOING: "#007AFF",
  NOW: "#FF3B30",
  LATER: "#FF9500",
  WAITING: "#B8860B",
  DONE: "#34C759",
  CANCELLED: "#8E8E93",
};

export function DailyTimeline() {
  const { dailyJournals, openDailyNote, aggregatedTasks, setDailyViewMode } = useNotesStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 按日期倒序排列
  const sortedJournals = useMemo(() => {
    return [...dailyJournals].sort((a, b) => {
      if (a.journal_date && b.journal_date) return b.journal_date.localeCompare(a.journal_date);
      return b.updated_at - a.updated_at;
    });
  }, [dailyJournals]);

  // 按月份分组
  const groupedByMonth = useMemo(() => {
    const groups: { month: string; journals: typeof dailyJournals }[] = [];
    let currentMonth = "";
    for (const j of sortedJournals) {
      const month = j.journal_date ? j.journal_date.substring(0, 7) : "unknown";
      if (month !== currentMonth) {
        groups.push({ month, journals: [j] });
        currentMonth = month;
      } else {
        groups[groups.length - 1].journals.push(j);
      }
    }
    return groups;
  }, [sortedJournals]);

  const handleCardClick = (journal: (typeof dailyJournals)[0]) => {
    if (journal.journal_date) {
      setDailyViewMode("single");
      openDailyNote(journal.journal_date);
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--color-bg-empty)" }}>
      {/* 顶部统计 */}
      <div className="px-6 py-4 border-b border-border" style={{ background: "var(--color-bg-primary)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">每日日志</h2>
            <p className="text-[12px] text-text-muted mt-0.5">共 {sortedJournals.length} 篇日志</p>
          </div>
          <div className="flex items-center gap-2">
            {aggregatedTasks.length > 0 && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
              style={{ background: "rgba(255,59,48,0.1)" }}
              title="来自普通笔记的跨日期活跃任务"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: "#FF3B30" }} />
              <span className="text-[12px] font-medium" style={{ color: "#FF3B30" }}>
                跨日期 {aggregatedTasks.length} 个活跃任务
              </span>
            </div>
            )}
            <button
              onClick={() => setDailyViewMode("single")}
              title="切换到单篇视图"
              className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: "var(--color-bg-input)", color: "var(--color-text-primary)" }}
            >
              📝 单篇
            </button>
          </div>
        </div>
      </div>

      {/* 时间线 */}
      <div className="px-6 py-4">
        {groupedByMonth.map((group) => (
          <div key={group.month} className="mb-8">
            {/* 月份标题 */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1" style={{ background: "var(--color-border)" }} />
              <span className="text-[13px] font-medium text-text-muted whitespace-nowrap">
                {group.month}
              </span>
              <div className="h-px flex-1" style={{ background: "var(--color-border)" }} />
            </div>

            {/* 日志卡片 */}
            <div className="space-y-3">
              {group.journals.map((journal) => {
                const isExpanded = expandedId === journal.id;
                // 从 task_lines 解析任务
                const tasks: TimelineTask[] = (journal.task_lines || []).map((line) => {
                  const m = line.match(TASK_PATTERN);
                  if (m) {
                    return { marker: m[2], text: m[3].replace(/\s*(?:started::|finished::|elapsed::|deadline::|scheduled::).*/g, "").trim() };
                  }
                  return null;
                }).filter((t): t is TimelineTask => t !== null);
                const relativeLabel = getRelativeLabel(journal.journal_date || "");

                return (
                  <div
                    key={journal.id}
                    className="rounded-xl border border-border transition-all cursor-pointer hover:shadow-md"
                    style={{ background: "var(--color-bg-primary)" }}
                    onClick={() => handleCardClick(journal)}
                  >
                    {/* 卡片头部 */}
                    <div className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[15px] font-semibold text-text-primary">
                            {journal.journal_date ? formatDateHeader(journal.journal_date) : journal.title}
                          </span>
                          {relativeLabel && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "var(--color-bg-input)", color: "var(--color-text-muted)" }}>
                              {relativeLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      {tasks.length > 5 && (
                        <button
                          className="text-[11px] px-2 py-1 rounded-md flex-shrink-0"
                          style={{ background: "var(--color-bg-input)", color: "var(--color-text-muted)" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : journal.id);
                          }}
                        >
                          {isExpanded ? "收起" : "展开"}
                        </button>
                      )}
                    </div>

                    {/* 任务列表 */}
                    {tasks.length > 0 && (
                      <div className="px-4 pb-2 space-y-1">
                        {tasks.slice(0, isExpanded ? undefined : 5).map((task, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-[13px]">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: MARKER_COLORS[task.marker] || "#8E8E93" }}
                            />
                            <span
                              className="text-[11px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{
                                background: `${MARKER_COLORS[task.marker] || "#8E8E93"}20`,
                                color: MARKER_COLORS[task.marker] || "#8E8E93",
                              }}
                            >
                              {task.marker}
                            </span>
                            <span className={`truncate ${task.marker === "DONE" || task.marker === "CANCELLED" ? "line-through text-text-muted" : "text-text-primary"}`}>
                              {task.text}
                            </span>
                          </div>
                        ))}
                        {!isExpanded && tasks.length > 5 && (
                          <div className="text-[11px] text-text-muted pl-3.5">
                            还有 {tasks.length - 5} 项...
                          </div>
                        )}
                      </div>
                    )}

                    {/* 底部信息 */}
                    <div className="px-4 py-2 border-t border-border flex items-center justify-between">
                      <span className="text-[11px] text-text-muted">
                        更新于 {formatTimestamp(journal.updated_at)}
                      </span>
                      {tasks.length > 0 && (
                        <span className="text-[11px] text-text-muted">
                          {tasks.filter((t) => t.marker !== "DONE" && t.marker !== "CANCELLED").length} 个待处理
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {sortedJournals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <p className="mt-3 text-sm">还没有日志</p>
            <p className="text-[12px] mt-1">点击侧栏「每日日志」创建第一篇</p>
          </div>
        )}
      </div>
    </div>
  );
}
