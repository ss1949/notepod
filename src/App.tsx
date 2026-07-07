import React, { Suspense, useEffect, useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { NoteList } from "./components/NoteList/NoteList";
import { QueryPanel } from "./components/QueryPanel/QueryPanel";
import { DailyHeader } from "./components/DailyView/DailyHeader";
import { CollapsiblePanel } from "./components/Layout/CollapsiblePanel";
import { LockOverlay } from "./components/Layout/LockOverlay";
import { LockScreenModal } from "./components/Layout/LockScreenModal";
import { EncryptionWizard } from "./components/Setup/EncryptionWizard";
import { GitBackupModal } from "./components/Layout/GitBackupModal";
import { MobileLayout } from "./components/Mobile/MobileLayout";
import { useLayout } from "./hooks/useLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useNotesStore } from "./stores/notesStore";
import { useQueryStore } from "./stores/queryStore";
import { useEncStore } from "./stores/encStore";
import { useUIStore } from "./stores/uiStore";
import { api, LockConfigInfo } from "./lib/tauri";
import { listen } from "@tauri-apps/api/event";

const Editor = React.lazy(() => import("./components/Editor/Editor").then((m) => ({ default: m.Editor })));
const DailyTimeline = React.lazy(() => import("./components/DailyView/DailyTimeline").then((m) => ({ default: m.DailyTimeline })));

function App() {
  const isMobile = useIsMobile();
  const {
    sidebarCollapsed,
    noteListCollapsed,
    focusMode,
    toggleSidebar,
    toggleNoteList,
    toggleFocusMode,
  } = useLayout();

  const { loadNotes, loadTags, loadFolders, loadFolderNoteCounts, loadDailyJournals, createNote, filterMode, openDailyNote, setFilterMode, dailyViewMode } = useNotesStore();
  const { toggleQueryPanel } = useQueryStore();
  const { checkFirstRun, showEncWizard, setShowEncWizard, checkEncStatus } = useEncStore();
  const { gitBackupModalOpen, setGitBackupModalOpen } = useUIStore();

  const isDailyMode = filterMode === "daily";
  const isGraphMode = filterMode === "graph";

  // 锁屏：初始设为 true，无论是否真有密码都先遮住 UI，避免未解锁时 Sidebar/Editor 发起请求
  const [isLocked, setIsLocked] = useState(true);
  const [isAutoLock, setIsAutoLock] = useState(true);
  const [lockConfig, setLockConfig] = useState<LockConfigInfo | null>(null);
  const [showLockSettings, setShowLockSettings] = useState(false);

  const loadLockConfig = useCallback(async () => {
    try {
      const config = await api.getLockConfig();
      setLockConfig(config);
      return config;
    } catch (e) {
      console.error('Failed to load lock config:', e);
      return null;
    }
  }, []);

  // 后台检查锁屏状态，无需锁则自动解锁并加载数据
  useEffect(() => {
    let cancelled = false;

    (async () => {
      console.log("[App] init start");
      const config = await loadLockConfig();
      if (cancelled) return;
      console.log("[App] lockConfig loaded, has_password:", config?.has_password);

      // 有密码 → 保持锁屏，只更新 config
      if (config?.has_password) {
        console.log("[App] → stay locked (has password)");
        setIsAutoLock(true);
        setIsLocked(true);  // 确认锁屏
        checkEncStatus();
        checkFirstRun();
        return;
      }

      // 无密码：检查加密状态
      await Promise.all([checkFirstRun(), checkEncStatus()]);
      if (cancelled) return;

      const encState = useEncStore.getState();
      console.log("[App] encState:", { hasConfig: encState.hasEncryptionConfig, enabled: encState.isEncryptionEnabled });
      if (encState.hasEncryptionConfig && !encState.isEncryptionEnabled) {
        console.log("[App] → stay locked (enc not unlocked)");
        setIsAutoLock(true);
        setIsLocked(true);
        return;
      }

      // 无需锁屏：自动解锁，加载数据
      console.log("[App] → auto-unlock, loading data...");
      setIsAutoLock(false);
      setIsLocked(false);
      await Promise.all([loadNotes(), loadTags(), loadFolders(), loadFolderNoteCounts(), loadDailyJournals()]);
      if (cancelled) return;
      console.log("[App] data loaded, setting daily filter...");
      setFilterMode("daily");
      console.log("[App] init done");
    })();

    return () => { cancelled = true; };
  }, []);

  // 监听 Rust 端的 sync-completed 事件，自动刷新数据
  useEffect(() => {
    const unlisten = listen("sync-completed", async () => {
      console.log("[App] sync-completed event received, refreshing data...");
      try {
        await Promise.all([loadNotes(), loadTags(), loadFolders(), loadFolderNoteCounts(), loadDailyJournals()]);
        setFilterMode("daily");
        console.log("[App] data refreshed after sync");
      } catch (e) {
        console.error("[App] refresh after sync failed:", e);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [loadNotes, loadTags, loadFolders, loadFolderNoteCounts, loadDailyJournals, setFilterMode]);

  // 解锁后：完整加载功能页数据
  const handleUnlock = useCallback(async () => {
    setIsLocked(false);
    setIsAutoLock(false);
    loadLockConfig();
    await checkEncStatus();
    await Promise.all([loadNotes(), loadTags(), loadFolders(), loadFolderNoteCounts(), loadDailyJournals()]);
    setFilterMode("daily");
  }, [loadLockConfig, checkEncStatus, loadNotes, loadTags, loadFolders, loadFolderNoteCounts, loadDailyJournals, setFilterMode]);

  // 锁屏按钮
  const handleLockClick = useCallback(async () => {
    try {
      const config = await api.getLockConfig();
      if (config?.has_password) {
        setIsAutoLock(false);
        setIsLocked(true);
      } else {
        setShowLockSettings(true);
      }
    } catch (e) {
      console.error('Failed to check lock config:', e);
    }
  }, []);

  const handleOpenLockSettings = useCallback(() => setShowLockSettings(true), []);
  const handleLockSettingsClose = useCallback(() => {
    setShowLockSettings(false);
    loadLockConfig();
  }, [loadLockConfig]);

  // 全局快捷键（仅在解锁状态下有效）
  useEffect(() => {
    if (isLocked) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); createNote(); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") { e.preventDefault(); toggleQueryPanel(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") { e.preventDefault(); openDailyNote(); }
      if (e.key === "Escape" && focusMode) { toggleFocusMode(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [createNote, toggleQueryPanel, focusMode, toggleFocusMode, openDailyNote, isLocked]);

  // 功能页始终渲染，锁屏仅作遮罩
  return (
    <div className="h-screen flex">
      {isMobile ? (
        /* ===== 移动端布局 ===== */
        <MobileLayout isLocked={isLocked} onLockClick={handleLockClick} />
      ) : (
        /* ===== 桌面端布局 ===== */
        <>
          {/* 侧边栏 */}
          <CollapsiblePanel collapsed={sidebarCollapsed} width={220} onToggle={toggleSidebar} side="left">
            <Sidebar onLockClick={handleLockClick} />
          </CollapsiblePanel>

          {/* 笔记列表（图谱模式下隐藏） */}
          <CollapsiblePanel collapsed={noteListCollapsed || isGraphMode} width={320} onToggle={toggleNoteList} side="right">
            <NoteList />
          </CollapsiblePanel>

          {/* 编辑器 */}
          <div className="flex-1 min-w-0" style={{ display: 'flex', flexDirection: 'column' }}>
            {isDailyMode && dailyViewMode === "single" && <DailyHeader />}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-text-muted"><div className="w-6 h-6 border-2 border-text-muted/30 border-t-accent rounded-full animate-spin" /></div>}>
                {isDailyMode && dailyViewMode === "timeline" ? (
                  <DailyTimeline />
                ) : (
                  <Editor appLocked={isLocked} />
                )}
              </Suspense>
            </div>
          </div>

          {/* 查询面板（浮层） */}
          <QueryPanel />
        </>
      )}

      {/* 锁屏遮罩（始终覆盖在 UI 之上，两种布局共享） */}
      {isLocked && (
        <LockOverlay
          lockConfig={lockConfig}
          onUnlock={handleUnlock}
          onOpenSettings={handleOpenLockSettings}
          hideSettings={isAutoLock}
        />
      )}

      {/* 锁屏密码设置弹窗 */}
      <LockScreenModal open={showLockSettings} onClose={handleLockSettingsClose} />

      {/* 首次启动加密向导 */}
      {showEncWizard && (
        <EncryptionWizard
          onComplete={() => { setShowEncWizard(false); loadLockConfig(); }}
          onSkip={() => { setShowEncWizard(false); loadLockConfig(); }}
        />
      )}

      {/* Git 备份同步弹窗（全局） */}
      <GitBackupModal
        open={gitBackupModalOpen}
        onClose={() => setGitBackupModalOpen(false)}
        onSyncComplete={async () => {
          try {
            await Promise.all([loadNotes(), loadTags(), loadFolders(), loadFolderNoteCounts(), loadDailyJournals()]);
          } catch (e) {
            console.error("同步后刷新数据失败:", e);
          }
        }}
      />
    </div>
  );
}

export default App;
