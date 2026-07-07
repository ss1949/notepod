import { useState, useMemo, useEffect } from "react";
import clsx from "clsx";
import { useNotesStore } from "../../stores/notesStore";
import { useQueryStore } from "../../stores/queryStore";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import type { Folder } from "../../lib/tauri";

interface MobileDrawerProps {
  onLockClick?: () => void;
}

export function MobileDrawer({ onLockClick }: MobileDrawerProps) {
  const {
    folders, tags, selectedFolderId, filterMode,
    setSelectedFolder, loadNotes, setFilterMode,
    selectNote, notes, trashNotes, openDailyNote,
    setGraphViewOpen, folderNoteCounts,
    createFolder, loadFolders,
    updateFolder, deleteFolder,
  } = useNotesStore();
  const { toggleQueryPanel } = useQueryStore();
  const { mobileDrawerOpen, setMobileDrawerOpen, darkMode, toggleDarkMode, setGitBackupModalOpen } = useUIStore();

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showBackupMenu, setShowBackupMenu] = useState(false);
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editFolder, setEditFolder] = useState<{ id: string; name: string; color: string } | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderColor, setEditFolderColor] = useState("#007AFF");
  const [moveFolderId, setMoveFolderId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const close = () => setMobileDrawerOpen(false);

  // 本地备份
  const handleBackup = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (dir) {
        const info = await api.createBackup(dir as string);
        alert(`备份成功！\n路径: ${info.path}\n笔记数: ${info.note_count}\n大小: ${(info.size / 1024).toFixed(1)} KB`);
      }
    } catch (e) { alert("备份失败: " + e); }
  };

  // 本地恢复
  const handleRestore = async () => {
    try {
      const file = await open({ filters: [{ name: "ZIP", extensions: ["zip"] }], multiple: false });
      if (file) {
        if (!confirm("恢复将覆盖当前数据，确定继续？")) return;
        const info = await api.restoreBackup(file as string);
        let msg = `恢复成功！\n笔记数: ${info.note_count}\n${info.migrated ? "已执行数据迁移" : ""}`;
        if (info.is_encrypted) {
          msg += "\n\n注意：备份中包含加密笔记，\n请重新输入加密密码以解密内容。";
        }
        alert(msg);
        window.location.reload();
      }
    } catch (e) { alert("恢复失败: " + e); }
  };

  // 创建文件夹
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder(name, "#007AFF");
      setNewFolderName("");
      setShowFolderInput(false);
    } catch (e) {
      alert("创建文件夹失败: " + e);
    }
  };

  // 打开编辑文件夹弹窗
  const handleEditFolder = (folder: Folder) => {
    setEditFolder({ id: folder.id, name: folder.name, color: folder.color });
    setEditFolderName(folder.name);
    setEditFolderColor(folder.color);
  };

  // 保存文件夹编辑
  const handleSaveEditFolder = async () => {
    if (!editFolder || !editFolderName.trim()) return;
    try {
      await updateFolder(editFolder.id, editFolderName.trim(), editFolderColor);
      setEditFolder(null);
    } catch (e) {
      alert("编辑文件夹失败: " + e);
    }
  };

  // 删除文件夹
  const handleDeleteFolder = async (id: string) => {
    try {
      await deleteFolder(id);
      setDeleteConfirm(null);
    } catch (e) {
      alert("删除文件夹失败: " + e);
    }
  };

  // 移动文件夹
  const handleMoveFolder = async (folderId: string, newParentId: string | null) => {
    try {
      await updateFolder(folderId, undefined, undefined, newParentId);
      setMoveFolderId(null);
    } catch (e) {
      alert("移动文件夹失败: " + e);
    }
  };

  // 控制抽屉挂载/卸载，配合 CSS transition 实现滑入/滑出
  const [visible, setVisible] = useState(mobileDrawerOpen);
  useEffect(() => {
    if (mobileDrawerOpen) {
      setVisible(true);
    } else {
      const timer = setTimeout(() => setVisible(false), 250);
      return () => clearTimeout(timer);
    }
  }, [mobileDrawerOpen]);

  const starredCount = notes.filter((n) => n.starred).length;
  const todoCount = notes.filter((n) => n.status === "todo").length;
  const trashCount = trashNotes.length;

  // 文件夹树
  const rootFolders = useMemo(
    () => folders.filter((f) => (f.parent_id ?? null) === null).sort((a, b) => a.sort_order - b.sort_order),
    [folders]
  );

  const childFolders = (parentId: string): Folder[] =>
    folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);

  const toggleExpand = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const goNav = (mode: typeof filterMode, folderId?: string | null) => {
    if (folderId !== undefined) setSelectedFolder(folderId);
    else setSelectedFolder(null);
    setFilterMode(mode);
    setGraphViewOpen(mode === "graph");
    selectNote(null);
    if (mode === "daily") loadNotes();
    if (mode === "all" && folderId) loadNotes(folderId || undefined);
    if (mode === "starred" || mode === "todo") loadNotes();
    close();
  };

  const renderFolder = (folder: Folder, depth: number) => {
    const children = childFolders(folder.id);
    const expanded = expandedFolders.has(folder.id);
    const active = selectedFolderId === folder.id && filterMode === "all";
    const count = folderNoteCounts[folder.id] || 0;

    return (
      <div key={folder.id}>
        <button
          onClick={() => goNav("all", folder.id)}
          className="flex items-center w-full text-left px-3 py-2 rounded-lg transition-colors active:bg-bg-sidebar-hover"
          style={{
            paddingLeft: 12 + depth * 16,
            color: active ? "var(--color-accent)" : "var(--color-text-primary)",
            background: active ? "var(--color-bg-sidebar-hover)" : "transparent",
          }}
        >
          {/* 展开/折叠箭头 */}
          {children.length > 0 && (
            <span
              className="flex items-center justify-center w-5 h-5 mr-1 text-text-muted shrink-0"
              onClick={(e) => { e.stopPropagation(); toggleExpand(folder.id); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          )}
          {children.length === 0 && <span className="w-5 mr-1 shrink-0" />}
          {/* 文件夹颜色点 */}
          <span className="w-3 h-3 rounded-sm mr-2 shrink-0" style={{ backgroundColor: folder.color }} />
          <span className="text-sm truncate flex-1">{folder.name}</span>
          {count > 0 && <span className="text-xs text-text-muted ml-1">{count}</span>}
          {/* 操作按钮 */}
          <span
            className="flex items-center justify-center w-6 h-6 ml-1 rounded-md text-text-muted shrink-0"
            onClick={(e) => { e.stopPropagation(); handleEditFolder(folder); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </span>
        </button>
        {expanded && children.map((c) => renderFolder(c, depth + 1))}
      </div>
    );
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/40 drawer-backdrop"
        onClick={close}
      />
      {/* 抽屉面板 */}
      <div
        className={clsx(
          "relative w-[80vw] max-w-[320px] h-full flex flex-col transition-transform duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ background: "var(--color-bg-sidebar)" }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="text-base font-semibold text-text-primary">NotePod</span>
          <button onClick={close} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted active:bg-bg-sidebar-hover">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto">
          {/* 导航项 */}
          <nav className="px-2 py-2 space-y-0.5">
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              label="日记"
              active={filterMode === "daily"}
              onClick={() => goNav("daily")}
            />
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
              label="所有笔记"
              count={Object.values(folderNoteCounts).reduce((s, c) => s + c, 0)}
              active={selectedFolderId === null && filterMode === "all"}
              onClick={() => goNav("all", null)}
            />
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
              label="加星笔记"
              count={starredCount}
              active={filterMode === "starred"}
              onClick={() => goNav("starred")}
            />
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              label="待办笔记"
              count={todoCount}
              active={filterMode === "todo"}
              onClick={() => goNav("todo")}
            />

            <div className="my-1" style={{ borderTop: "1px solid var(--color-border)" }} />

            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
              label="关系图谱"
              active={filterMode === "graph"}
              onClick={() => goNav("graph")}
            />
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>}
              label="高级查询"
              active={filterMode === "query"}
              onClick={() => { toggleQueryPanel(); close(); }}
            />
            <DrawerNavItem
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>}
              label="回收站"
              count={trashCount}
              active={filterMode === "trash"}
              onClick={() => goNav("trash")}
            />
          </nav>

          {/* 文件夹 */}
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">文件夹</span>
            <button
              onClick={() => { setShowFolderInput(!showFolderInput); setNewFolderName(""); }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted active:bg-bg-sidebar-hover transition-colors"
              title="新建文件夹"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
          <div className="px-2 pb-2">
            {showFolderInput && (
              <div className="flex items-center gap-1 px-3 py-1.5">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowFolderInput(false); }}
                  placeholder="文件夹名称"
                  className="flex-1 text-sm px-2 py-1.5 rounded-md border border-border bg-bg-input text-text-primary outline-none"
                  autoFocus
                />
                <button onClick={handleCreateFolder} className="px-2 py-1.5 text-xs font-medium text-white bg-accent rounded-md">确定</button>
                <button onClick={() => setShowFolderInput(false)} className="px-2 py-1.5 text-xs text-text-muted">取消</button>
              </div>
            )}
            {rootFolders.length === 0 && (
              <div className="text-xs text-text-muted px-3 py-2">暂无文件夹</div>
            )}
            {rootFolders.map((f) => renderFolder(f, 0))}
          </div>

          {/* 标签 */}
          <div className="px-4 pt-3 pb-1">
            <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">标签</span>
          </div>
          <div className="px-3 pb-4 flex flex-wrap gap-1.5" style={{ minHeight: 28 }}>
            {tags.length === 0 ? (
              <span className="text-[11px] text-text-muted">暂无标签</span>
            ) : (
              tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-xl text-[11px] font-medium bg-bg-input text-text-secondary"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </span>
              ))
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="px-3 py-2 space-y-1" style={{ borderTop: "1px solid var(--color-border)" }}>
          <div className="flex items-center gap-1">
            {/* 锁屏 */}
            <button onClick={() => { onLockClick?.(); close(); }} className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors" title="锁屏">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </button>
            {/* 本地备份 */}
            <button onClick={() => setShowBackupMenu(!showBackupMenu)} className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors relative" title="备份与恢复">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            {/* Git 同步 */}
            <button onClick={() => { setGitBackupModalOpen(true); close(); }} className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors" title="Git 备份同步">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
            </button>
            <div className="flex-1" />
            {/* 暗色模式 */}
            <button onClick={toggleDarkMode} className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary active:bg-bg-sidebar-hover transition-colors" title={darkMode ? "浅色模式" : "深色模式"}>
              {darkMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>
          </div>
        </div>

        {/* 备份菜单弹窗 */}
        {showBackupMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowBackupMenu(false)} />
            <div className="absolute bottom-12 left-3 z-50 min-w-40 rounded-lg py-1 shadow-lg" style={{ background: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}>
              <button onClick={() => { setShowBackupMenu(false); handleBackup(); }} className="flex items-center gap-2 w-full text-left text-sm px-3 py-2.5 hover:bg-bg-sidebar-hover text-text-primary transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>本地备份</span>
              </button>
              <button onClick={() => { setShowBackupMenu(false); handleRestore(); }} className="flex items-center gap-2 w-full text-left text-sm px-3 py-2.5 hover:bg-bg-sidebar-hover text-text-primary transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span>本地恢复</span>
              </button>
            </div>
          </>
        )}

        {/* 文件夹编辑弹窗 */}
        {editFolder && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setEditFolder(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-xl p-5 shadow-2xl" style={{ background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-text-primary">编辑文件夹</span>
                <button onClick={() => setEditFolder(null)} className="w-6 h-6 flex items-center justify-center text-text-muted">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <input
                type="text"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                placeholder="文件夹名称"
                className="w-full text-sm px-3 py-2 rounded-md border border-border bg-bg-input text-text-primary outline-none mb-3"
              />
              <div className="flex gap-2 mb-4">
                {["#007AFF", "#34C759", "#FF9500", "#FF3B30", "#AF52DE", "#5856D6", "#FF2D55", "#8E8E93"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditFolderColor(c)}
                    className="w-7 h-7 rounded-full transition-transform"
                    style={{ backgroundColor: c, transform: editFolderColor === c ? "scale(1.2)" : "scale(1)", border: editFolderColor === c ? "2px solid var(--color-text-primary)" : "2px solid transparent" }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveEditFolder} className="flex-1 py-2.5 text-sm font-medium text-white bg-accent rounded-md">保存</button>
                <button onClick={() => setDeleteConfirm(editFolder.id)} className="flex-1 py-2.5 text-sm font-medium text-white bg-red-500 rounded-md">删除</button>
              </div>
            </div>
          </>
        )}

        {/* 删除确认弹窗 */}
        {deleteConfirm && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setDeleteConfirm(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-xl p-5 shadow-2xl" style={{ background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border)" }}>
              <p className="text-sm text-text-primary mb-4">确定删除此文件夹？</p>
              <div className="flex gap-2">
                <button onClick={() => handleDeleteFolder(deleteConfirm)} className="flex-1 py-2.5 text-sm font-medium text-white bg-red-500 rounded-md">删除</button>
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 text-sm font-medium text-text-primary bg-bg-sidebar-hover rounded-md">取消</button>
              </div>
            </div>
          </>
        )}

        {/* 移动文件夹选择弹窗 */}
        {moveFolderId && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setMoveFolderId(null)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-xl p-5 shadow-2xl max-h-[50vh] overflow-y-auto" style={{ background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-text-primary">移动到...</span>
                <button onClick={() => setMoveFolderId(null)} className="w-6 h-6 flex items-center justify-center text-text-muted">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <button onClick={() => { handleMoveFolder(moveFolderId, null); }} className="flex items-center gap-2 w-full text-left text-sm px-3 py-2.5 rounded-lg hover:bg-bg-sidebar-hover text-text-primary">
                根目录
              </button>
              {folders.filter(f => f.id !== moveFolderId).map(f => (
                <button key={f.id} onClick={() => handleMoveFolder(moveFolderId, f.id)} className="flex items-center gap-2 w-full text-left text-sm px-3 py-2.5 rounded-lg hover:bg-bg-sidebar-hover text-text-primary">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: f.color }} />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

/* 抽屉内导航项 */
function DrawerNavItem({
  icon, label, count, active, onClick,
}: {
  icon: React.ReactNode; label: string; count?: number; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center w-full text-left px-3 py-2 rounded-lg transition-colors active:bg-bg-sidebar-hover"
      style={{
        color: active ? "var(--color-accent)" : "var(--color-text-primary)",
        background: active ? "var(--color-bg-sidebar-hover)" : "transparent",
      }}
    >
      <span className="mr-2.5 shrink-0">{icon}</span>
      <span className="text-sm flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-text-muted">{count}</span>
      )}
    </button>
  );
}
