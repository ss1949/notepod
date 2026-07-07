import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  noteListCollapsed: boolean;
  focusMode: boolean;
  darkMode: boolean;

  // 移动端
  mobileDrawerOpen: boolean;
  mobileView: "list" | "editor";

  // Git 备份弹窗（全局，桌面/移动端共用）
  gitBackupModalOpen: boolean;

  toggleSidebar: () => void;
  toggleNoteList: () => void;
  toggleFocusMode: () => void;
  setDarkMode: (dark: boolean) => void;
  toggleDarkMode: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setNoteListCollapsed: (collapsed: boolean) => void;

  // 移动端 actions
  setMobileDrawerOpen: (open: boolean) => void;
  toggleMobileDrawer: () => void;
  setMobileView: (view: "list" | "editor") => void;

  // Git 备份弹窗 actions
  setGitBackupModalOpen: (open: boolean) => void;
  toggleGitBackupModal: () => void;
}

const STORAGE_KEY = "notepod-ui-state";

function loadState(): Partial<UIState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

const saved = loadState();

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: saved.sidebarCollapsed ?? false,
  noteListCollapsed: saved.noteListCollapsed ?? false,
  focusMode: false,
  darkMode: saved.darkMode ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false),
  mobileDrawerOpen: false,
  mobileView: "list" as const,
  gitBackupModalOpen: false,

  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed: collapsed });
    saveState(get());
  },

  toggleNoteList: () => {
    const collapsed = !get().noteListCollapsed;
    set({ noteListCollapsed: collapsed });
    saveState(get());
  },

  toggleFocusMode: () => {
    const focus = !get().focusMode;
    if (focus) {
      set({ focusMode: true, sidebarCollapsed: true, noteListCollapsed: true });
    } else {
      set({ focusMode: false, sidebarCollapsed: false, noteListCollapsed: false });
      saveState(get());
    }
  },

  setDarkMode: (dark) => {
    set({ darkMode: dark });
    applyDarkMode(dark);
    saveState(get());
  },

  toggleDarkMode: () => {
    const dark = !get().darkMode;
    set({ darkMode: dark });
    applyDarkMode(dark);
    saveState(get());
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    saveState(get());
  },

  setNoteListCollapsed: (collapsed) => {
    set({ noteListCollapsed: collapsed });
    saveState(get());
  },

  setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),
  toggleMobileDrawer: () => set({ mobileDrawerOpen: !get().mobileDrawerOpen }),
  setMobileView: (view) => set({ mobileView: view }),

  setGitBackupModalOpen: (open) => set({ gitBackupModalOpen: open }),
  toggleGitBackupModal: () => set({ gitBackupModalOpen: !get().gitBackupModalOpen }),
}));

function applyDarkMode(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  // 通知 Android 状态栏切换主题
  try { (window as any).NotePodBridge?.setStatusBarTheme(dark); } catch {}
}

function saveState(state: UIState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed: state.sidebarCollapsed,
        noteListCollapsed: state.noteListCollapsed,
        darkMode: state.darkMode,
      })
    );
  } catch {}
}

// 初始化时应用暗色模式
applyDarkMode(saved.darkMode ?? false);
