import { invoke } from "@tauri-apps/api/core";

// Types matching Rust models
export interface Note {
  id: string;
  title: string;
  content: string;
  folder_id: string | null;
  status: string;
  priority: string;
  starred: boolean;
  pinned: boolean;
  is_encrypted: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tags: string[];
  // TODO 增强字段
  due_date: number | null;
  reminder: number | null;
  parent_task_id: string | null;
  note_type: string;
  journal_date: string | null;
}

export interface NoteRow {
  id: string;
  title: string;
  content_preview: string;
  tags: string[];
  priority: string;
  status: string;
  starred: boolean;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  note_type: string;
}

// 笔记摘要（列表视图用，含 task_lines / block_ids / wiki_links 用于功能支持）
export interface NoteSummary {
  id: string;
  title: string;
  folder_id: string | null;
  status: string;
  priority: string;
  starred: boolean;
  pinned: boolean;
  is_encrypted: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  tags: string[];
  due_date: number | null;
  reminder: number | null;
  parent_task_id: string | null;
  note_type: string;
  journal_date: string | null;
  task_lines?: string[];
  block_ids?: [string, string][];
  wiki_links?: string[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string;
  sort_order: number;
}

export interface FolderNoteCount {
  folder_id: string;
  count: number;
}

export interface ActivityDay {
  date: string;
  count: number;
}

export interface QueryParams {
  keyword?: string;
  date_from?: number;
  date_to?: number;
  tag_ids: string[];
  priorities: string[];
  status?: string;
  note_type?: string;
  starred_only: boolean;
  limit?: number;
  offset?: number;
}

export interface BackupInfo {
  path: string;
  size: number;
  note_count: number;
  created_at: string;
}

export interface RestoreInfo {
  note_count: number;
  migrated: boolean;
  restored_at: string;
  is_encrypted: boolean;
}

export interface GitConfig {
  repo_url: string;
  username: string;
  credential: string;
  author_name?: string;
  author_email?: string;
  last_sync_at?: string;
}

export interface GitSyncResult {
  success: boolean;
  message: string;
  synced_at?: string;
}

export interface GitConfigSaveResult {
  has_encryption: boolean;
}

export interface LockConfigInfo {
  has_password: boolean;
  hint: string;
}

// Encryption
export interface EncStatus {
  enabled: boolean;
  has_config: boolean;
}

// IPC wrappers
export const api = {
  // Note CRUD
  createNote: (req: { title: string; content: string; folder_id?: string; priority?: string; status?: string }) =>
    invoke<Note>("create_note", { req }),
  getNote: (noteId: string) => invoke<Note>("get_note", { noteId }),
  listNotes: (folderId?: string) => invoke<Note[]>("list_notes", { folderId }),
  listNotesSummary: (folderId?: string) => invoke<NoteSummary[]>("list_notes_summary", { folderId }),
  listDailyNotesSummary: () => invoke<NoteSummary[]>("list_daily_notes_summary"),
  getNoteContent: (noteId: string) => invoke<string>("get_note_content", { noteId }),
  updateNote: (req: { id: string; title?: string; content?: string; folder_id?: string | null; created_at?: number; deleted_at?: number | null; due_date?: number | null }) =>
    invoke<Note>("update_note", { req }),
  deleteNote: (noteId: string) => invoke<void>("delete_note", { noteId }),
  restoreNote: (noteId: string) => invoke<Note>("restore_note", { noteId }),

  // Metadata
  toggleNoteStatus: (noteId: string) => invoke<Note>("toggle_note_status", { noteId }),
  setNotePriority: (noteId: string, priority: string) => invoke<Note>("set_note_priority", { noteId, priority }),
  setNoteStarred: (noteId: string, starred: boolean) => invoke<Note>("set_note_starred", { noteId, starred }),
  setNotePinned: (noteId: string, pinned: boolean) => invoke<Note>("set_note_pinned", { noteId, pinned }),
  setNoteTags: (noteId: string, tags: string[]) => invoke<Note>("set_note_tags", { noteId, tags }),
  setNoteDueDate: (noteId: string, dueDate: number | null) => invoke<Note>("set_note_due_date", { noteId, dueDate }),
  countNotesByFolder: () => invoke<FolderNoteCount[]>("count_notes_by_folder"),
  getActivityHeatmap: (days: number) => invoke<ActivityDay[]>("get_activity_heatmap", { days }),

  // Folders
  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string, color: string, parentId?: string) =>
    invoke<Folder>("create_folder", { name, color, parentId: parentId ?? null }),
  deleteFolder: (folderId: string) => invoke<void>("delete_folder", { folderId }),
  renameFolder: (folderId: string, name: string) => invoke<void>("rename_folder", { folderId, name }),
  updateFolder: (folderId: string, name?: string, color?: string, parentId?: string | null) =>
    invoke<void>("update_folder", {
      folderId,
      name: name ?? null,
      color: color ?? null,
      parentId: parentId === undefined ? null : parentId,
    }),

  // Tags
  listTags: () => invoke<Tag[]>("list_tags"),
  createTag: (name: string, color: string) => invoke<Tag>("create_tag", { name, color }),
  deleteTag: (tagId: string) => invoke<void>("delete_tag", { tagId }),

  // Query
  queryNotes: (params: QueryParams) => invoke<NoteRow[]>("query_notes", { params }),

  // Export
  exportCsv: (params: QueryParams, destPath: string) => invoke<number>("export_csv", { params, destPath }),
  exportNoteMd: (noteId: string, destPath: string) => invoke<void>("export_note_md", { noteId, destPath }),
  importNoteFromMd: (filePath: string, folderId?: string) => invoke<Note>("import_note_from_md", { filePath, folderId: folderId ?? null }),

  // Backup
  createBackup: (destDir: string, password?: string) => invoke<BackupInfo>("create_backup", { destDir, password }),
  restoreBackup: (zipPath: string, password?: string) => invoke<RestoreInfo>("restore_backup", { zipPath, password }),

  // Daily Notes
  getDailyNote: (date: string) => invoke<Note | null>("get_daily_note", { date }),
  createDailyNote: (date: string) => invoke<Note>("create_daily_note", { date }),
  getOrCreateDailyNote: (date: string) => invoke<Note>("get_or_create_daily_note", { date }),
  listDailyNotes: () => invoke<Note[]>("list_daily_notes"),

  // Git Backup & Sync
  saveGitConfig: (config: GitConfig) => invoke<GitConfigSaveResult>("save_git_config", { config }),
  getGitConfig: () => invoke<GitConfig | null>("get_git_config"),
  gitBackup: () => invoke<GitSyncResult>("git_backup"),
  gitSync: () => invoke<GitSyncResult>("git_sync"),

  // Lock Screen + Encryption（单密码方案：锁屏密码即加密密码）
  setLockPassword: (password: string, hint: string) => invoke<void>("set_lock_password", { password, hint }),
  changeLockPassword: (oldPassword: string, newPassword: string, hint: string) =>
    invoke<void>("change_lock_password", { oldPassword, newPassword, hint }),
  getLockConfig: () => invoke<LockConfigInfo | null>("get_lock_config"),
  verifyLockPassword: (password: string) => invoke<boolean>("verify_lock_password", { password }),
  removeLockPassword: () => invoke<void>("remove_lock_password"),

  // 加密状态查询（单密码方案：has_config = 锁屏密码已设置）
  getEncStatus: () => invoke<EncStatus>('get_enc_status'),

  // 从 key.json 导入加密配置（新电脑恢复）
  importEncConfig: (keyJson: string, password: string) => invoke<void>("import_enc_config", { keyJson, password }),

  // 从 Git 仓库的 key.json 恢复加密配置（新电脑场景）
  restoreEncFromGit: (password: string) => invoke<void>("restore_enc_from_git", { password }),
};
