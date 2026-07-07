import { useState, useRef, useEffect, useMemo } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useQueryStore } from "../../stores/queryStore";
import { useUIStore } from "../../stores/uiStore";
import { api } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { AppleModal } from "../Layout/AppleModal";
import { LockScreenModal } from "../Layout/LockScreenModal";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { GraphView } from "../GraphView/GraphView";
import clsx from "clsx";
import type { Folder } from "../../lib/tauri";

const FOLDER_COLORS = [
  "#007AFF", "#FF3B30", "#FF9500", "#34C759",
  "#AF52DE", "#FF2D55", "#5AC8FA", "#8E8E93",
];

export function Sidebar({ onLockClick }: { onLockClick?: () => void }) {
  const {
    folders, tags, selectedFolderId, filterMode,
    setSelectedFolder, loadNotes, setFilterMode,
    createFolder, deleteFolder, updateFolder, notes, trashNotes,
    folderNoteCounts, loadFolderNoteCounts, openDailyNote, dailyJournals,
    loadDailyJournals, selectNote, graphViewOpen, setGraphViewOpen,
  } = useNotesStore();
  const { toggleQueryPanel } = useQueryStore();
  const { darkMode, toggleDarkMode, setGitBackupModalOpen } = useUIStore();

  const [showFolderInput, setShowFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    folder: Folder;
    x: number;
    y: number;
  } | null>(null);
  const [moveMenu, setMoveMenu] = useState<{
    folder: Folder;
    x: number;
    y: number;
  } | null>(null);
  const [editFolder, setEditFolder] = useState<Folder | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderColor, setEditFolderColor] = useState(FOLDER_COLORS[0]);
  const [showBackupMenu, setShowBackupMenu] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [showLockMenu, setShowLockMenu] = useState(false);

  // 弹窗状态
  const [folderModal, setFolderModal] = useState<{
    open: boolean;
    mode: "alert" | "confirm";
    title: string;
    message: string;
    tone: "default" | "warning" | "danger";
    onConfirm?: () => void;
  } | null>(null);

  const starredCount = notes.filter((n) => n.starred).length;
  const todoCount = notes.filter((n) => n.status === "todo").length;
  const trashCount = trashNotes.length;
  const allNoteCount = Object.values(folderNoteCounts).reduce((sum, c) => sum + c, 0);

  // 侧边栏图谱默认展示所有笔记 + 每日日志
  const graphNotes = useMemo(() => [...notes, ...dailyJournals], [notes, dailyJournals]);
  // dailyJournals 由 App 初始化统一加载，Sidebar 不再独立请求

  const handleFolderClick = (folderId: string | null) => {
    setSelectedFolder(folderId);
    setFilterMode("all");
    setGraphViewOpen(false);
    selectNote(null);
    loadNotes(folderId || undefined);
  };

  const handleStarredClick = () => {
    setSelectedFolder(null);
    setFilterMode("starred");
    setGraphViewOpen(false);
    selectNote(null);
    loadNotes();
  };

  const handleTodoClick = () => {
    setSelectedFolder(null);
    setFilterMode("todo");
    setGraphViewOpen(false);
    selectNote(null);
    loadNotes();
  };

  const handleTrashClick = () => {
    setSelectedFolder(null);
    setFilterMode("trash");
    setGraphViewOpen(false);
    selectNote(null);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder(newFolderName.trim(), newFolderColor, newFolderParent || undefined);
    await loadFolderNoteCounts();
    if (newFolderParent) {
      setExpandedFolders((prev) => new Set(prev).add(newFolderParent));
    }
    setNewFolderName("");
    setNewFolderColor(FOLDER_COLORS[0]);
    setNewFolderParent(null);
    setShowFolderInput(false);
  };

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ folder, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const closeMenu = () => { setContextMenu(null); setMoveMenu(null); }
    if (contextMenu || moveMenu) {
      window.addEventListener("click", closeMenu);
      window.addEventListener("contextmenu", closeMenu);
      return () => {
        window.removeEventListener("click", closeMenu);
        window.removeEventListener("contextmenu", closeMenu);
      };
    }
  }, [contextMenu, moveMenu]);

  const handleEditFolder = (folder: Folder) => {
    setEditFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderColor(folder.color);
    setContextMenu(null);
  };

  const handleSaveEditFolder = async () => {
    if (!editFolder || !editFolderName.trim()) return;
    await updateFolder(editFolder.id, editFolderName.trim(), editFolderColor);
    setEditFolder(null);
  };

  const handleBackup = async () => {
    try {
      const dir = await open({ directory: true, multiple: false });
      if (dir) {
        const info = await api.createBackup(dir as string);
        alert(`备份成功！\n路径: ${info.path}\n笔记数: ${info.note_count}\n大小: ${(info.size / 1024).toFixed(1)} KB`);
      }
    } catch (e) {
      alert("备份失败: " + e);
    }
  };

  const handleRestore = async () => {
    try {
      const file = await open({
        filters: [{ name: "ZIP", extensions: ["zip"] }],
        multiple: false,
      });
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
    } catch (e) {
      alert("恢复失败: " + e);
    }
  };

  // 构建文件夹树
  const buildFolderTree = (parentId: string | null): Folder[] => {
    return folders
      .filter((f) => (f.parent_id ?? null) === parentId)
      .sort((a, b) => a.sort_order - b.sort_order);
  };

  const getFolderNoteCount = (folderId: string): number => {
    return folderNoteCounts[folderId] || 0;
  };

  const handleDeleteFolder = (folder: Folder) => {
    const children = buildFolderTree(folder.id);
    const hasSubFolders = children.length > 0;
    const hasNotes = notes.some((n) => n.folder_id === folder.id);

    if (hasSubFolders || hasNotes) {
      setFolderModal({
        open: true,
        mode: "alert",
        title: "无法删除文件夹",
        message:
          `文件夹 "${folder.name}" 不为空，包含：\n` +
          (hasSubFolders ? `• ${children.length} 个子文件夹\n` : "") +
          (hasNotes ? `• ${getFolderNoteCount(folder.id)} 条笔记\n` : "") +
          `\n请先移除非空内容后再删除。`,
        tone: "warning",
      });
      return;
    }

    setFolderModal({
      open: true,
      mode: "confirm",
      title: "删除文件夹",
      message: `确定要删除文件夹 "${folder.name}" 吗？此操作不可恢复。`,
      tone: "danger",
      onConfirm: () => {
        deleteFolder(folder.id);
        setFolderModal(null);
      },
    });
  };

  const renderFolder = (folder: Folder, level: number): React.ReactNode => {
    const children = buildFolderTree(folder.id);
    const isExpanded = expandedFolders.has(folder.id);
    const hasChildren = children.length > 0;
    const hasNotesRaw = notes.some((n) => n.folder_id === folder.id);
    const isNonEmpty = hasChildren || hasNotesRaw;
    const noteCount = getFolderNoteCount(folder.id);
    const isActive = selectedFolderId === folder.id && filterMode === "all";

    return (
      <div key={folder.id}>
        <div
          className={clsx(
            "flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors group",
            isActive
              ? "bg-bg-sidebar-active text-accent"
              : "hover:bg-bg-sidebar-hover text-text-primary"
          )}
          style={{ paddingLeft: `${6 + level * 16}px`, fontSize: "13px", fontWeight: 500 }}
          onClick={() => handleFolderClick(folder.id)}
          onContextMenu={(e) => handleContextMenu(e, folder)}
        >
          {/* 展开/折叠箭头：Apple Notes 风格，始终有一个点击区域 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(folder.id);
            }}
            className={clsx(
              "flex-shrink-0 flex items-center justify-center rounded transition-all duration-150",
              hasChildren
                ? "cursor-pointer hover:bg-bg-sidebar-hover"
                : "cursor-default"
            )}
            style={{
              width: 16,
              height: 16,
            }}
          >
            {hasChildren ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.18s ease",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            ) : (
              <span style={{ width: 14, height: 14 }} />
            )}
          </button>

          {/* 文件夹颜色圆点 */}
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: folder.color }}
          />

          {/* 文件夹名称 */}
          <span className="flex-1 truncate">{folder.name}</span>

          {/* 笔记计数（hover时隐藏，让位给操作按钮） */}
          {noteCount > 0 && (
            <span className={clsx(
              "text-[11px] font-semibold flex-shrink-0 group-hover:hidden",
              isActive ? "text-accent" : "text-text-muted"
            )}>
              {noteCount}
            </span>
          )}

          {/* 操作按钮：hover 才显示 */}
          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setNewFolderParent(folder.id);
                setShowFolderInput(true);
                if (!isExpanded) toggleExpand(folder.id);
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-[12px] font-semibold text-text-muted hover:bg-bg-sidebar-hover hover:text-text-secondary transition-colors"
              title="新建子文件夹"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteFolder(folder);
              }}
              className={clsx(
                "w-5 h-5 flex items-center justify-center rounded text-[12px] font-semibold transition-colors",
                "text-text-muted hover:bg-bg-sidebar-hover hover:text-danger"
              )}
              title="删除文件夹"
            >
              ×
            </button>
          </div>
        </div>

        {/* 子文件夹列表 */}
        {hasChildren && isExpanded && (
          <div>
            {children.map((child) => renderFolder(child, level + 1))}
          </div>
        )}

        {/* 子文件夹新建输入框 */}
        {showFolderInput && newFolderParent === folder.id && (
          <div style={{ paddingLeft: `${22 + level * 16}px` }} className="py-1">
            <FolderInputRow
              name={newFolderName}
              setName={setNewFolderName}
              color={newFolderColor}
              setColor={setNewFolderColor}
              onConfirm={handleCreateFolder}
              onCancel={() => {
                setShowFolderInput(false);
                setNewFolderParent(null);
                setNewFolderName("");
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const rootFolders = buildFolderTree(null);

  return (
    <div className="h-full flex flex-col bg-bg-sidebar select-none">
      {/* Header: App Title */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "18px 12px 10px" }}
      >
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "-0.3px",
            marginRight: "auto",
          }}
          className="text-text-primary"
        >
          NotePod
        </h1>
        <button
          onClick={() => {
            setShowFolderInput(!showFolderInput);
            setNewFolderParent(null);
            setNewFolderName("");
          }}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg-sidebar-hover text-text-secondary transition-colors"
          title="新建文件夹"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        </button>
      </div>

      {/* Smart views nav */}
      <nav className="px-2">
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="8" y2="18.01"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>}
          label="每日日志"
          count={dailyJournals.length}
          showZero
          active={filterMode === "daily"}
          onClick={() => {
            // 只在首次进入每日模式时打开今日日志，避免每次点击都重置编辑器
            const enteringDaily = filterMode !== "daily";
            setSelectedFolder(null);
            setFilterMode("daily");
            setGraphViewOpen(false);
            selectNote(null);
            if (enteringDaily) {
              openDailyNote();
            }
          }}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
          label="所有笔记"
          count={allNoteCount}
          active={selectedFolderId === null && filterMode === "all"}
          onClick={() => handleFolderClick(null)}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>}
          label="加星笔记"
          count={starredCount}
          active={filterMode === "starred"}
          onClick={handleStarredClick}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
          label="待办笔记"
          count={todoCount}
          active={filterMode === "todo"}
          onClick={handleTodoClick}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
          label="关系图谱"
          active={filterMode === "graph"}
          onClick={() => {
            setSelectedFolder(null);
            selectNote(null);
            setFilterMode("graph");
            setGraphViewOpen(true);
          }}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>}
          label="高级查询"
          active={filterMode === "query"}
          onClick={() => {
            setSelectedFolder(null);
            setFilterMode("query");
            setGraphViewOpen(false);
            selectNote(null);
          }}
        />
        <NavItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>}
          label="回收站"
          count={trashCount}
          active={filterMode === "trash"}
          onClick={handleTrashClick}
        />
      </nav>

      {/* Folders section */}
      <div className="flex items-center justify-between" style={{ padding: "16px 16px 6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.5px" }} className="text-text-muted uppercase">
          文件夹
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {rootFolders.length === 0 && !showFolderInput && (
          <div className="text-xs text-text-muted px-2.5 py-2">暂无文件夹</div>
        )}
        {rootFolders.map((f) => renderFolder(f, 0))}
        {showFolderInput && newFolderParent === null && (
          <div className="py-1">
            <FolderInputRow
              name={newFolderName}
              setName={setNewFolderName}
              color={newFolderColor}
              setColor={setNewFolderColor}
              onConfirm={handleCreateFolder}
              onCancel={() => {
                setShowFolderInput(false);
                setNewFolderName("");
              }}
            />
          </div>
        )}
      </nav>

      {/* Tags section */}
      <div className="flex items-center justify-between" style={{ padding: "16px 16px 6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.5px" }} className="text-text-muted uppercase">
          标签
        </span>
      </div>
      <div className="px-3 pb-2 flex flex-wrap gap-1.5" style={{ minHeight: "28px" }}>
        {tags.length === 0 ? (
          <span className="text-[11px] text-text-muted">暂无标签</span>
        ) : (
          tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-xl text-[11px] font-medium bg-bg-input text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors cursor-default"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))
        )}
      </div>

      {/* 活动热力图 */}
      <ActivityHeatmap />

      {/* Footer: Apple-style backup menu + dark mode toggle */}
      <div className="relative flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1">
          {/* 锁屏按钮 */}
          <button
            onClick={() => setShowLockMenu(!showLockMenu)}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors"
            title="锁屏"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </button>
          {/* 备份菜单按钮 */}
          <button
            onClick={() => setShowBackupMenu(!showBackupMenu)}
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors"
            title="备份与恢复"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          {/* 云备份按钮（Git 同步） */}
          <button
            className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors"
            title="Git 备份同步"
            onClick={() => setGitBackupModalOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
            </svg>
          </button>
        </div>
        {/* 深色模式切换 */}
        <button
          onClick={toggleDarkMode}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors"
          title={darkMode ? "浅色模式" : "深色模式"}
        >
          {darkMode ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>

        {/* 备份菜单弹窗 */}
        {showBackupMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowBackupMenu(false)} />
            <div
              className="absolute bottom-full left-3 mb-2 z-50 min-w-40 rounded-lg py-1 shadow-lg"
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              <button
                onClick={() => { setShowBackupMenu(false); handleBackup(); }}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>本地备份</span>
              </button>
              <button
                onClick={() => { setShowBackupMenu(false); handleRestore(); }}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>本地恢复</span>
              </button>
              <div className="my-1" style={{ borderTop: "1px solid var(--color-border)" }} />
              <button
                onClick={() => { setShowBackupMenu(false); setGitBackupModalOpen(true); }}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                </svg>
                <span>Git 备份同步</span>
              </button>
            </div>
          </>
        )}

        {/* 锁屏菜单弹窗 */}
        {showLockMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowLockMenu(false)} />
            <div
              className="absolute bottom-full left-3 mb-2 z-50 min-w-40 rounded-lg py-1 shadow-lg"
              style={{
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              <button
                onClick={() => {
                  setShowLockMenu(false);
                  if (onLockClick) onLockClick();
                }}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>立即锁屏</span>
              </button>
              <button
                onClick={() => {
                  setShowLockMenu(false);
                  setShowLockModal(true);
                }}
                className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 hover:bg-bg-sidebar-hover text-text-primary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>密码设置</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-36 rounded-lg py-1"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleEditFolder(contextMenu.folder)}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary"
          >
            重命名 / 颜色
          </button>
          <button
            onClick={() => {
              setNewFolderParent(contextMenu.folder.id);
              setShowFolderInput(true);
              if (!expandedFolders.has(contextMenu.folder.id)) {
                toggleExpand(contextMenu.folder.id);
              }
              setContextMenu(null);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary"
          >
            新建子文件夹
          </button>
          <div className="my-1" style={{ borderTop: "1px solid var(--color-border)" }} />
          <button
            onClick={() => {
              const f = contextMenu.folder;
              setMoveMenu({ folder: f, x: contextMenu.x + 4, y: contextMenu.y });
              setContextMenu(null);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary"
          >
            移动到...
          </button>
          <div className="my-1" style={{ borderTop: "1px solid var(--color-border)" }} />
          <button
            onClick={() => {
              const f = contextMenu.folder;
              setContextMenu(null);
              handleDeleteFolder(f);
            }}
            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-danger"
          >
            删除文件夹
          </button>
        </div>
      )}

      {/* 移动到子菜单 */}
      {moveMenu && (
        <div
          className="fixed z-50 min-w-44 max-h-80 overflow-y-auto rounded-lg py-1"
          style={{
            left: moveMenu.x,
            top: moveMenu.y,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if ((moveMenu.folder.parent_id ?? null) === null) {
                setMoveMenu(null);
                return;
              }
              updateFolder(moveMenu.folder.id, undefined, undefined, null);
              setMoveMenu(null);
            }}
            disabled={(moveMenu.folder.parent_id ?? null) === null}
            className={clsx(
              "block w-full text-left text-xs px-3 py-1.5 text-text-primary",
              (moveMenu.folder.parent_id ?? null) === null
                ? "opacity-40 cursor-not-allowed"
                : "hover:bg-bg-sidebar-hover"
            )}
          >
            根目录
          </button>
          {(() => {
            const current = moveMenu.folder;
            // 构建目标文件夹的层级路径
            const pathMap: Record<string, string> = {};
            (function build(id: string | null, segs: string[]) {
              const children = folders.filter((f) => (f.parent_id ?? null) === id);
              for (const child of children) {
                if (child.id === current.id) continue; // 跳过自己
                const path = [...segs, child.name];
                pathMap[child.id] = path.join(" / ");
                build(child.id, path);
              }
            })(null, []);
            // 收集不能作为目标的（后代文件夹）
            const descendants = new Set<string>();
            (function collect(id: string) {
              const children = folders.filter((f) => (f.parent_id ?? null) === id);
              for (const child of children) {
                descendants.add(child.id);
                collect(child.id);
              }
            })(current.id);

            const targets = folders
              .filter((f) => f.id !== current.id && !descendants.has(f.id))
              .sort((a, b) => {
                const pa = pathMap[a.id] || a.name;
                const pb = pathMap[b.id] || b.name;
                return pa.localeCompare(pb);
              });

            if (targets.length === 0) {
              return (
                <div className="text-xs px-3 py-1.5 text-text-muted italic">
                  无可用目标
                </div>
              );
            }
            return targets.map((folder) => (
              <button
                key={folder.id}
                onClick={() => {
                  updateFolder(moveMenu.folder.id, undefined, undefined, folder.id);
                  setMoveMenu(null);
                }}
                className={clsx(
                  "block w-full text-left text-xs px-3 py-1.5 hover:bg-bg-sidebar-hover text-text-primary flex items-center gap-2",
                  current.parent_id === folder.id && "bg-bg-sidebar-active text-accent"
                )}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: folder.color }}
                />
                <span className="truncate">{pathMap[folder.id] || folder.name}</span>
              </button>
            ));
          })()}
        </div>
      )}

      {/* 文件夹编辑弹窗 */}
      {editFolder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "var(--color-bg-modal)" }}
          onClick={() => setEditFolder(null)}
        >
          <div
            className="rounded-xl p-6 min-w-80"
            style={{
              background: "var(--color-bg-primary)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
              animation: "slideUp 0.2s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-bold text-text-primary mb-4">编辑文件夹</div>
            <input
              type="text"
              value={editFolderName}
              onChange={(e) => setEditFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEditFolder();
                if (e.key === "Escape") setEditFolder(null);
              }}
              autoFocus
              placeholder="文件夹名称..."
              className="w-full text-sm px-3 py-2.5 rounded-md outline-none transition-colors"
              style={{
                background: "var(--color-bg-input)",
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-text-primary)",
              }}
            />
            <div className="flex items-center gap-2 my-3.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setEditFolderColor(c)}
                  className="w-6 h-6 rounded-full transition-transform"
                  style={{
                    backgroundColor: c,
                    border: editFolderColor === c ? "2px solid var(--color-text-primary)" : "2px solid transparent",
                    transform: editFolderColor === c ? "scale(1.15)" : undefined,
                  }}
                />
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setEditFolder(null)}
                className="px-5 py-2 rounded-md text-[13px] font-semibold bg-bg-input text-text-primary hover:opacity-80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEditFolder}
                className="px-5 py-2 rounded-md text-[13px] font-semibold text-text-on-accent bg-accent hover:bg-accent-hover transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：文件夹删除确认 / 警告 */}
      {folderModal && (
        <AppleModal
          open={folderModal.open}
          title={folderModal.title}
          message={folderModal.message}
          mode={folderModal.mode}
          tone={folderModal.tone}
          onCancel={() => setFolderModal(null)}
          onConfirm={() => {
            folderModal.onConfirm?.();
            setFolderModal(null);
          }}
          confirmText={folderModal.mode === "alert" ? "好" : "删除"}
        />
      )}

      {/* 锁屏密码设置弹窗 */}
      <LockScreenModal open={showLockModal} onClose={() => {
        setShowLockModal(false);
        // 关闭弹窗后重新加载笔记（可能已解锁加密）
        loadNotes();
        loadDailyJournals();
      }} />
    </div>
  );
}

/** Nav item with SVG icon + badge count */
function NavItem({
  icon, label, count, showZero, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  showZero?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2.5 py-2 px-2.5 rounded-md cursor-pointer transition-colors",
        active
          ? "bg-bg-sidebar-active text-accent"
          : "hover:bg-bg-sidebar-hover text-text-primary"
      )}
      style={{ fontSize: "13px", fontWeight: 500 }}
    >
      <span className={clsx("flex-shrink-0", active ? "opacity-100" : "opacity-70")}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (count > 0 || showZero) && (
        <span className={clsx(
          "text-[11px] font-semibold min-w-5 text-right",
          active ? "text-accent" : "text-text-muted"
        )}>
          {count}
        </span>
      )}
    </div>
  );
}

/** 文件夹创建行（内联输入） */
function FolderInputRow({
  name, setName, color, setColor, onConfirm, onCancel,
}: {
  name: string;
  setName: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md bg-bg-input">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="文件夹名称..."
        autoFocus
        className="w-full text-sm px-2 py-1 rounded outline-none"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-strong)",
          color: "var(--color-text-primary)",
        }}
      />
      <div className="flex items-center gap-1">
        {FOLDER_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className="w-4 h-4 rounded-full transition-transform"
            style={{
              backgroundColor: c,
              border: color === c ? "2px solid var(--color-text-primary)" : "2px solid transparent",
              transform: color === c ? "scale(1.1)" : undefined,
            }}
          />
        ))}
      </div>
      <div className="flex gap-1">
        <button
          onClick={onConfirm}
          className="text-xs px-2.5 py-1 rounded-md text-text-on-accent bg-accent hover:bg-accent-hover transition-colors"
        >
          确定
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-2.5 py-1 rounded-md bg-bg-primary text-text-secondary hover:opacity-80 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}
