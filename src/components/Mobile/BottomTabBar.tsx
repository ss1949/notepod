import { useNotesStore } from "../../stores/notesStore";
import { useUIStore } from "../../stores/uiStore";

const tabs = [
  {
    key: "daily",
    label: "日记",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    key: "all",
    label: "笔记",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    key: "starred",
    label: "收藏",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    key: "todo",
    label: "待办",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    key: "more",
    label: "更多",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </svg>
    ),
  },
] as const;

export function BottomTabBar() {
  const { filterMode, setFilterMode, selectNote, setSelectedFolder, openDailyNote, setGraphViewOpen } = useNotesStore();
  const { toggleMobileDrawer, setMobileDrawerOpen } = useUIStore();

  const activeKey = filterMode === "daily" ? "daily"
    : filterMode === "starred" ? "starred"
    : filterMode === "todo" ? "todo"
    : "all";

  const handleTab = (key: string) => {
    if (key === "more") {
      toggleMobileDrawer();
      return;
    }
    setMobileDrawerOpen(false);
    setSelectedFolder(null);
    setGraphViewOpen(false);
    selectNote(null);
    setFilterMode(key as any);
    // 日记模式不自动打开笔记，只显示列表
  };

  return (
    <div
      className="flex items-center justify-around shrink-0 safe-bottom"
      style={{
        height: 56,
        background: "var(--color-bg-toolbar)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            onClick={() => handleTab(tab.key)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-0 transition-colors"
            style={{
              color: active ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
