import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { useNotesStore } from '../../stores/notesStore';
import { useIsMobile } from '../../hooks/useIsMobile';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

function formatChineseDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAYS[d.getDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日`;
}

function formatMobileDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAY_SHORT[d.getDay()];
  return `${month}月${day}日 周${weekday}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const DailyHeader = memo(function DailyHeader() {
  const { dailyDate, dailyNote, navigateDaily, openDailyNote, updateNoteContent, dailyViewMode, setDailyViewMode } = useNotesStore();
  const isMobile = useIsMobile();
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [animDir, setAnimDir] = useState<'none' | 'left' | 'right'>('none');

  // 日历面板显示的年月
  const [calYear, setCalYear] = useState(() => {
    const d = new Date(dailyDate + 'T00:00:00');
    return d.getFullYear();
  });
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(dailyDate + 'T00:00:00');
    return d.getMonth();
  });

  // 当 dailyDate 变化时同步日历面板
  useEffect(() => {
    const d = new Date(dailyDate + 'T00:00:00');
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
  }, [dailyDate]);

  // 点击外部关闭日历
  useEffect(() => {
    if (!showCalendar) return;
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendar]);

  // 日期切换动画
  useEffect(() => {
    if (animDir !== 'none') {
      const timer = setTimeout(() => setAnimDir('none'), 200);
      return () => clearTimeout(timer);
    }
  }, [animDir]);

  const isToday = dailyDate === toLocalDate(new Date());

  const goToToday = useCallback(() => {
    openDailyNote();
    setShowCalendar(false);
  }, [openDailyNote]);

  const goPrev = useCallback(() => {
    setAnimDir('right');
    navigateDaily(-1);
  }, [navigateDaily]);

  const goNext = useCallback(() => {
    setAnimDir('left');
    navigateDaily(1);
  }, [navigateDaily]);

  const handleAddTodo = useCallback(() => {
    if (!dailyNote) return;
    const todoLine = "\n## 待办事项\n- TODO 新待办\n";
    const newContent = (dailyNote.content || '') + todoLine;
    updateNoteContent(dailyNote.id, dailyNote.title, newContent);
  }, [dailyNote, updateNoteContent]);

  const handleDayClick = useCallback((day: number) => {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    openDailyNote(dateStr);
    setShowCalendar(false);
  }, [calYear, calMonth, openDailyNote]);

  const handlePrevMonth = useCallback(() => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear(y => y - 1);
    } else {
      setCalMonth(m => m - 1);
    }
  }, [calMonth]);

  const handleNextMonth = useCallback(() => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear(y => y + 1);
    } else {
      setCalMonth(m => m + 1);
    }
  }, [calMonth]);

  // 构建日历网格
  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfMonth(calYear, calMonth);
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const today = new Date();
  const todayStr = toLocalDate(today);

  // 判断是否有日志
  const hasJournal = !!dailyNote;

  return (
    <div
      ref={calendarRef}
      style={{
        background: 'var(--color-bg-toolbar)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '0 8px' : '0 16px',
      height: '44px',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* 左侧：日期导航 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* 前一天按钮 */}
        <button
          onClick={goPrev}
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '8px',
            color: 'var(--color-text-secondary)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-input)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
          }}
          title="前一天"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* 日期显示 + 日历触发器 */}
        <div>
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            style={{
              background: showCalendar ? 'var(--color-bg-input)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: isMobile ? '5px 10px' : '6px 14px',
              borderRadius: '10px',
              fontSize: isMobile ? '13px' : '15px',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.2px',
              transition: 'all 0.2s ease',
              position: 'relative',
              overflow: 'hidden',
            }}
            title="选择日期"
          >
            <span
              style={{
                display: 'inline-block',
                transition: 'transform 0.2s ease, opacity 0.15s ease',
                transform: animDir === 'left' ? 'translateX(-8px)' : animDir === 'right' ? 'translateX(8px)' : 'translateX(0)',
                opacity: animDir !== 'none' ? 0.6 : 1,
              }}
            >
              {isMobile ? formatMobileDate(dailyDate) : formatChineseDate(dailyDate)}
            </span>
          </button>
        </div>

        {/* 后一天按钮 */}
        <button
          onClick={goNext}
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '8px',
            color: 'var(--color-text-secondary)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-input)';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
          }}
          title="后一天"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* 右侧：视图切换 + 操作 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* 视图切换 - Apple 风格 Segmented Control */}
        <div
          style={{
            display: 'flex',
            background: 'var(--color-bg-input)',
            borderRadius: '10px',
            padding: '2px',
            gap: '1px',
          }}
        >
          <button
            onClick={() => setDailyViewMode("single")}
            style={{
              padding: isMobile ? '4px 10px' : '5px 14px',
              fontSize: '12px',
              fontWeight: dailyViewMode === "single" ? 600 : 400,
              color: dailyViewMode === "single" ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              background: dailyViewMode === "single" ? 'var(--color-bg-secondary)' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: dailyViewMode === "single" ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            单篇
          </button>
          <button
            onClick={() => setDailyViewMode("timeline")}
            style={{
              padding: isMobile ? '4px 10px' : '5px 14px',
              fontSize: '12px',
              fontWeight: dailyViewMode === "timeline" ? 600 : 400,
              color: dailyViewMode === "timeline" ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              background: dailyViewMode === "timeline" ? 'var(--color-bg-secondary)' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: dailyViewMode === "timeline" ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            瀑布流
          </button>
        </div>

        {/* 新增待办按钮 */}
        {dailyNote && !/## 待办事项/.test(dailyNote.content || '') && (
          <button
            onClick={handleAddTodo}
            title="新增待办"
            style={{
              background: 'var(--color-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.85';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            }}
          >
            + 待办
          </button>
        )}
      </div>

      {/* 日历弹出面板 */}
      {showCalendar && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: isMobile ? '8px' : '50%',
                right: isMobile ? '8px' : undefined,
                transform: isMobile ? 'none' : 'translateX(-50%)',
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.05)',
                padding: '16px',
                width: isMobile ? 'auto' : '296px',
                maxWidth: '360px',
                zIndex: 1000,
                animation: 'scaleIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* 月份导航 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <button
                  onClick={handlePrevMonth}
                  style={{
                    width: '28px', height: '28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderRadius: '8px', color: 'var(--color-text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-input)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'none';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.2px' }}>
                  {calYear}年{calMonth + 1}月
                </span>
                <button
                  onClick={handleNextMonth}
                  style={{
                    width: '28px', height: '28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderRadius: '8px', color: 'var(--color-text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-input)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'none';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              {/* 星期标题 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
                {WEEKDAY_SHORT.map((w) => (
                  <div key={w} style={{
                    textAlign: 'center', fontSize: '11px', fontWeight: 500,
                    color: 'var(--color-text-muted)', padding: '4px 0',
                  }}>{w}</div>
                ))}
              </div>

              {/* 日期网格 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                {calendarDays.map((day, i) => {
                  if (day === null) {
                    return <div key={`empty-${i}`} />;
                  }
                  const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const isSelected = dateStr === dailyDate;
                  const isTodayDay = dateStr === todayStr;

                  return (
                    <button
                      key={day}
                      onClick={() => handleDayClick(day)}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        border: isSelected ? 'none' : isTodayDay ? '1.5px solid var(--color-accent)' : 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: isSelected || isTodayDay ? 600 : 400,
                        color: isSelected ? '#fff' : isTodayDay ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        background: isSelected ? 'var(--color-accent)' : 'transparent',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          (e.target as HTMLButtonElement).style.background = 'var(--color-bg-input)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          (e.target as HTMLButtonElement).style.background = 'transparent';
                        }
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* 今天按钮 */}
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={goToToday}
                  disabled={isToday}
                  style={{
                    background: isToday ? 'transparent' : 'var(--color-accent)',
                    color: isToday ? 'var(--color-text-muted)' : '#fff',
                    border: isToday ? '1px solid var(--color-border)' : 'none',
                    borderRadius: '10px',
                    padding: '6px 24px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isToday ? 'default' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  今天
                </button>
              </div>
            </div>
          )}
    </div>
  );
});
