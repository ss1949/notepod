import { useEffect } from "react";
import { useUIStore } from "../stores/uiStore";

/** 三栏布局管理 hook */
export function useLayout() {
  const {
    sidebarCollapsed,
    noteListCollapsed,
    focusMode,
    toggleSidebar,
    toggleNoteList,
    toggleFocusMode,
  } = useUIStore();

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘[ 或 Ctrl+[  收缩侧栏
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      }
      // ⌘] 或 Ctrl+]  收缩列表
      if ((e.metaKey || e.ctrlKey) && e.key === "]") {
        e.preventDefault();
        toggleNoteList();
      }
      // ⌘. 或 Ctrl+.  专注模式
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        toggleFocusMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSidebar, toggleNoteList, toggleFocusMode]);

  return {
    sidebarCollapsed,
    noteListCollapsed,
    focusMode,
    toggleSidebar,
    toggleNoteList,
    toggleFocusMode,
  };
}
