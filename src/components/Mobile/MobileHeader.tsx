import { useUIStore } from "../../stores/uiStore";
import { useNotesStore } from "../../stores/notesStore";

interface MobileHeaderProps {
  variant: "list" | "editor";
  title?: string;
}

export function MobileHeader({ variant, title }: MobileHeaderProps) {
  const { toggleMobileDrawer, setMobileView } = useUIStore();
  const { selectNote } = useNotesStore();

  const handleBack = () => {
    selectNote(null);
    setMobileView("list");
  };

  return (
    <div
      className="flex items-center px-3 shrink-0 safe-top"
      style={{
        height: 44,
        background: "var(--color-bg-toolbar)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {variant === "list" ? (
        <>
          {/* 汉堡菜单 */}
          <button
            onClick={toggleMobileDrawer}
            className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {/* 标题 */}
          <div className="flex-1 text-center">
            <span className="text-sm font-semibold text-text-primary">{title || "NotePod"}</span>
          </div>
          {/* 占位，保持标题居中 */}
          <div className="w-9" />
        </>
      ) : (
        <>
          {/* 返回按钮 */}
          <button
            onClick={handleBack}
            className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          {/* 标题 */}
          <div className="flex-1 text-center truncate px-2">
            <span className="text-sm font-semibold text-text-primary truncate block">{title || ""}</span>
          </div>
          {/* 占位 */}
          <div className="w-9" />
        </>
      )}
    </div>
  );
}
