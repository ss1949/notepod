import { useUIStore } from "../../stores/uiStore";
import { useNotesStore } from "../../stores/notesStore";
import { useQueryStore } from "../../stores/queryStore";
import { api } from "../../lib/tauri";
import { open, save } from "@tauri-apps/plugin-dialog";

export function Toolbar() {
  const { toggleSidebar, toggleNoteList, toggleFocusMode, focusMode, darkMode, toggleDarkMode } =
    useUIStore();
  const { createNote } = useNotesStore();
  const { toggleQueryPanel } = useQueryStore();

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
        // 重新加载数据
        window.location.reload();
      }
    } catch (e) {
      alert("恢复失败: " + e);
    }
  };

  return (
    <div className="flex items-center justify-between px-3 py-1.5 bg-bg-secondary border-b border-border">
      {/* 左侧：布局控制 */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleSidebar}
          className="text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary transition-colors"
          title="收缩/展开侧栏 (⌘[)"
        >
          ◧
        </button>
        <button
          onClick={toggleNoteList}
          className="text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary transition-colors"
          title="收缩/展开列表 (⌘])"
        >
          ◨
        </button>
        <button
          onClick={toggleFocusMode}
          className={`text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary transition-colors ${
            focusMode ? "bg-accent text-white" : ""
          }`}
          title="专注模式 (⌘.)"
        >
          ⤢
        </button>
      </div>

      {/* 中间：标题 */}
      <div className="text-sm font-medium text-text-secondary">NotePod</div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-1">
        <button
          onClick={createNote}
          className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent-hover transition-colors"
          title="新建笔记 (⌘N)"
        >
          + 新建
        </button>
        <button
          onClick={toggleQueryPanel}
          className="text-xs px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
          title="查询面板 (⌘⇧F)"
        >
          🔍 查询
        </button>
        <div className="w-px h-5 bg-border mx-1" />
        <button
          onClick={handleBackup}
          className="text-xs px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
          title="全量备份 (⌘⇧B)"
        >
          💾 备份
        </button>
        <button
          onClick={handleRestore}
          className="text-xs px-2 py-1 rounded hover:bg-bg-tertiary transition-colors"
          title="从备份恢复 (⌘⇧R)"
        >
          ♻️ 恢复
        </button>
        <div className="w-px h-5 bg-border mx-1" />
        <button
          onClick={toggleDarkMode}
          className="text-sm w-7 h-7 flex items-center justify-center rounded hover:bg-bg-tertiary transition-colors"
          title="切换暗色模式"
        >
          {darkMode ? "☀️" : "🌙"}
        </button>
      </div>
    </div>
  );
}
