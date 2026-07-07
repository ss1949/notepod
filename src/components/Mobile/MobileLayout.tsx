import React, { Suspense, useEffect } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useUIStore } from "../../stores/uiStore";
import { useQueryStore } from "../../stores/queryStore";
import { BottomTabBar } from "./BottomTabBar";
import { MobileHeader } from "./MobileHeader";
import { MobileDrawer } from "./MobileDrawer";
import { NoteList } from "../NoteList/NoteList";
import { DailyHeader } from "../DailyView/DailyHeader";
import { QueryPanel } from "../QueryPanel/QueryPanel";
import { GraphView } from "../GraphView/GraphView";

const Editor = React.lazy(() => import("../Editor/Editor").then((m) => ({ default: m.Editor })));
const DailyTimeline = React.lazy(() => import("../DailyView/DailyTimeline").then((m) => ({ default: m.DailyTimeline })));

interface MobileLayoutProps {
  isLocked: boolean;
  onLockClick?: () => void;
}

const headerTitles: Record<string, string> = {
  daily: "日记",
  all: "所有笔记",
  starred: "加星笔记",
  todo: "待办笔记",
  trash: "回收站",
  query: "高级查询",
  graph: "关系图谱",
};

export function MobileLayout({ isLocked, onLockClick }: MobileLayoutProps) {
  const { currentNote, filterMode, dailyViewMode, selectNote, notes, dailyJournals, folders, setFilterMode, setGraphViewOpen } = useNotesStore();
  const { mobileView, setMobileView } = useUIStore();

  const isDailyMode = filterMode === "daily";
  const isGraphMode = filterMode === "graph";
  const isTrashMode = filterMode === "trash";

  // 当选中笔记变化时自动切换视图
  useEffect(() => {
    if (currentNote) {
      setMobileView("editor");
    }
  }, [currentNote?.id]);

  // 编辑器模式：有选中笔记且非图谱
  const showEditor = mobileView === "editor" && currentNote && !isGraphMode && !isTrashMode;
  const showList = !showEditor && !isGraphMode && !isTrashMode;

  const editorTitle = currentNote?.title || "";

  // 图谱节点点击 → 退出图谱，跳转到笔记
  const handleGraphNodeClick = (noteId: string) => {
    const note = notes.find(n => n.id === noteId) || dailyJournals.find(n => n.id === noteId);
    if (note) {
      setFilterMode("all");
      setGraphViewOpen(false);
      selectNote(note);
      setMobileView("editor");
    }
  };

  return (
    <div className="h-screen w-full flex flex-col safe-top" style={{ background: "var(--color-bg-primary)" }}>
      {/* 编辑器视图头部（含返回按钮） */}
      {showEditor && (
        <MobileHeader variant="editor" title={editorTitle} />
      )}

      {/* 图谱模式：全屏浮层 */}
      {isGraphMode && (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="text-sm font-semibold">关系图谱</span>
            <button
              onClick={() => { setFilterMode("all"); selectNote(null); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted active:bg-bg-sidebar-hover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <Suspense fallback={
              <div className="w-full h-full flex items-center justify-center text-text-muted">
                <div className="w-6 h-6 border-2 border-text-muted/30 border-t-accent rounded-full animate-spin" />
              </div>
            }>
              <GraphView notes={notes} journals={dailyJournals} folders={folders} onNodeClick={handleGraphNodeClick} />
            </Suspense>
          </div>
        </div>
      )}

      {/* 回收站：全屏浮层 */}
      {isTrashMode && (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--color-bg-primary)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="text-sm font-semibold">回收站</span>
            <button
              onClick={() => { setFilterMode("all"); selectNote(null); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted active:bg-bg-sidebar-hover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <NoteList />
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        {showList ? (
          <>
            {/* 列表视图：日记模式始终显示 DailyHeader（含单篇/瀑布流切换） */}
            {isDailyMode && <DailyHeader />}
            {isDailyMode && dailyViewMode === "timeline" ? (
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center text-text-muted">
                  <div className="w-6 h-6 border-2 border-text-muted/30 border-t-accent rounded-full animate-spin" />
                </div>
              }>
                <DailyTimeline />
              </Suspense>
            ) : (
              <NoteList />
            )}
          </>
        ) : showEditor ? (
          <>
            {/* 编辑器视图 */}
            {isDailyMode && dailyViewMode === "single" && <DailyHeader />}
            <div className="flex-1 min-h-0">
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center text-text-muted">
                  <div className="w-6 h-6 border-2 border-text-muted/30 border-t-accent rounded-full animate-spin" />
                </div>
              }>
                {isDailyMode && dailyViewMode === "timeline" ? (
                  <DailyTimeline />
                ) : (
                  <Editor appLocked={isLocked} />
                )}
              </Suspense>
            </div>
          </>
        ) : null}
      </div>

      {/* 底部 Tab 栏（列表视图时显示） */}
      {showList && <BottomTabBar />}

      {/* 查询面板 */}
      <QueryPanel />

      {/* 左侧抽屉 */}
      <MobileDrawer onLockClick={onLockClick} />
    </div>
  );
}
