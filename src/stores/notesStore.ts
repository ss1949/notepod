import { create } from "zustand";
import { api, Note, NoteSummary, Tag, Folder, FolderNoteCount } from "../lib/tauri";

const toLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface NotesState {
  notes: NoteSummary[];
  trashNotes: NoteSummary[];
  currentNote: Note | null;
  currentNoteContent: string;
  tags: Tag[];
  folders: Folder[];
  folderNoteCounts: Record<string, number>;
  loading: boolean;
  selectedFolderId: string | null;
  filterMode: "all" | "starred" | "todo" | "trash" | "query" | "daily" | "graph";
  isNewNote: boolean;
  dailyNote: Note | null;
  dailyDate: string;
  dailyJournals: NoteSummary[];
  graphViewOpen: boolean;
  dailyViewMode: "single" | "timeline";
  // 跨日期任务聚合
  aggregatedTasks: { noteId: string; noteTitle: string; taskLine: string; marker: string }[];

  loadNotes: (folderId?: string) => Promise<void>;
  loadTags: () => Promise<void>;
  loadFolders: () => Promise<void>;
  loadFolderNoteCounts: () => Promise<void>;
  loadDailyJournals: () => Promise<void>;
  selectNote: (note: NoteSummary | Note | null) => Promise<void>;
  createNote: () => Promise<void>;
  updateNoteContent: (id: string, title: string, content: string) => Promise<void>;
  updateNoteTime: (id: string, createdAt: number) => Promise<void>;
  softDeleteNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  permanentDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  toggleStatus: (id: string) => Promise<void>;
  setPriority: (id: string, priority: string) => Promise<void>;
  toggleStarred: (id: string, starred: boolean) => Promise<void>;
  togglePinned: (id: string, pinned: boolean) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  setDueDate: (id: string, dueDate: number | null) => Promise<void>;
  setSelectedFolder: (folderId: string | null) => void;
  setFilterMode: (mode: "all" | "starred" | "todo" | "trash" | "query" | "daily" | "graph") => void;
  setGraphViewOpen: (open: boolean) => void;
  createFolder: (name: string, color: string, parentId?: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  updateFolder: (folderId: string, name?: string, color?: string, parentId?: string | null) => Promise<void>;
  updateNoteFolder: (noteId: string, folderId: string | null) => Promise<void>;
  importNoteFromMd: (filePath: string) => Promise<void>;
  openDailyNote: (date?: string) => Promise<void>;
  createDailyNote: (date?: string) => Promise<void>;
  navigateDaily: (offset: number) => Promise<void>;
  aggregateTasks: () => void;
  setDailyViewMode: (mode: "single" | "timeline") => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  trashNotes: [],
  currentNote: null,
  currentNoteContent: "",
  tags: [],
  folders: [],
  folderNoteCounts: {},
  loading: false,
  selectedFolderId: null,
  filterMode: "all",
  isNewNote: false,
  dailyNote: null,
  dailyDate: toLocalDate(new Date()),
  dailyJournals: [],
  graphViewOpen: false,
  dailyViewMode: "single",
  aggregatedTasks: [],

  loadNotes: async (folderId) => {
    set({ loading: true });
    try {
      // 使用 summary 接口（含 task_lines），大幅减少数据传输
      const allNotes = await api.listNotesSummary(folderId);
      const active = allNotes.filter((n) => !n.deleted_at);
      const trashFromApi = allNotes.filter((n) => !!n.deleted_at);
      const existingTrash = get().trashNotes;
      const activeIds = new Set(active.map((n) => n.id));
      const apiTrashIds = new Set(trashFromApi.map((n) => n.id));
      const mergedTrash = [
        ...trashFromApi,
        ...existingTrash.filter((t) => !apiTrashIds.has(t.id) && !activeIds.has(t.id)),
      ];
      mergedTrash.sort((a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
      set({ notes: active, trashNotes: mergedTrash, loading: false });
      // 加载完成后聚合任务
      get().aggregateTasks();
    } catch (e) {
      console.error("Failed to load notes:", e);
      set({ loading: false });
    }
  },

  // 跨日期任务聚合：从所有笔记的 task_lines 中提取活跃任务
  aggregateTasks: () => {
    const { notes } = get();
    const TASK_PATTERN = /^(?:\s*[-*+]\s+)?(TODO|DOING|NOW|LATER|WAITING)\s+(.+)$/;
    const tasks: { noteId: string; noteTitle: string; taskLine: string; marker: string }[] = [];
    for (const note of notes) {
      for (const line of (note.task_lines || [])) {
        const m = line.match(TASK_PATTERN);
        if (m) {
          tasks.push({
            noteId: note.id,
            noteTitle: note.title,
            taskLine: m[2].trim(),
            marker: m[1],
          });
        }
      }
    }
    set({ aggregatedTasks: tasks });
  },

  loadTags: async () => {
    try {
      const tags = await api.listTags();
      set({ tags });
    } catch (e) {
      console.error("Failed to load tags:", e);
    }
  },

  loadFolders: async () => {
    try {
      const folders = await api.listFolders();
      set({ folders });
    } catch (e) {
      console.error("Failed to load folders:", e);
    }
  },

  loadFolderNoteCounts: async () => {
    try {
      const counts = await api.countNotesByFolder();
      const map: Record<string, number> = {};
      for (const c of counts) {
        map[c.folder_id] = c.count;
      }
      set({ folderNoteCounts: map });
    } catch (e) {
      console.error("Failed to load folder note counts:", e);
    }
  },

  loadDailyJournals: async () => {
    try {
      const journals = await api.listDailyNotesSummary();
      set({ dailyJournals: journals });
    } catch (e) {
      console.error("Failed to load daily journals:", e);
    }
  },

  selectNote: async (note) => {
    if (!note) {
      set({ currentNote: null, currentNoteContent: "", isNewNote: false, graphViewOpen: false });
      return;
    }
    set({ currentNote: note as Note, isNewNote: false, graphViewOpen: false });
    // 按需加载笔记内容
    try {
      const content = await api.getNoteContent(note.id);
      set({ currentNoteContent: content });
    } catch (e) {
      console.error("Failed to load note content:", e);
      set({ currentNoteContent: "" });
    }
  },

  createNote: async () => {
    try {
      const folderId = get().selectedFolderId;
      const note = await api.createNote({
        title: "新建笔记",
        content: "",
        folder_id: folderId || undefined,
      });
      const { content: _, ...summary } = note;
      const { notes } = get();
      set({ currentNote: note, currentNoteContent: "", isNewNote: true, notes: [summary, ...notes] });
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  },

  updateNoteContent: async (id, title, content) => {
    const { currentNote, currentNoteContent } = get();
    // 内容与标题均未变化时跳过保存，避免无意义更新 updated_at 导致列表重排
    if (currentNote?.id === id && currentNote.title === title && currentNoteContent === content) {
      return;
    }
    try {
      const updated = await api.updateNote({ id, title, content });
      const { dailyNote } = get();
      set({
        currentNote: updated,
        currentNoteContent: content,
        dailyNote: dailyNote?.id === id ? updated : dailyNote,
      });
      const { notes, dailyJournals } = get();
      // 从 Note 中剥离 content 存入 summary 数组
      const { content: _, ...summary } = updated;
      set({
        notes: notes.map((n) => (n.id === id ? summary : n)),
        dailyJournals: dailyJournals.map((n) => (n.id === id ? summary : n)),
      });
    } catch (e) {
      console.error("Failed to update note:", e);
    }
  },

  updateNoteTime: async (id, createdAt) => {
    try {
      const updated = await api.updateNote({ id, created_at: createdAt });
      set({ currentNote: updated });
      const { notes, dailyJournals } = get();
      const { content: _, ...summary } = updated;
      set({
        notes: notes.map((n) => (n.id === id ? summary : n)),
        dailyJournals: dailyJournals.map((n) => (n.id === id ? summary : n)),
      });
    } catch (e) {
      console.error("Failed to update note time:", e);
    }
  },

  softDeleteNote: async (id) => {
    try {
      const note = get().notes.find((n) => n.id === id) ?? get().currentNote;
      if (!note) return;
      const deletedAt = Date.now();
      await api.updateNote({ id, deleted_at: deletedAt });
      const deletedNote = { ...note, deleted_at: deletedAt };
      // 从 active 列表移除，加入 trash 列表
      const { notes, trashNotes, currentNote } = get();
      set({
        notes: notes.filter((n) => n.id !== id),
        trashNotes: [deletedNote, ...trashNotes],
        currentNote: currentNote?.id === id ? null : currentNote,
      });
      get().aggregateTasks();
      await get().loadFolderNoteCounts();
      await get().loadDailyJournals();
    } catch (e) {
      console.error("Failed to soft delete note:", e);
    }
  },

  restoreNote: async (id) => {
    try {
      const note = get().trashNotes.find((n) => n.id === id);
      if (!note) return;
      const restoredNote = await api.restoreNote(id);
      const { content: _, ...summary } = restoredNote;
      const { notes, trashNotes } = get();
      set({
        notes: [summary, ...notes],
        trashNotes: trashNotes.filter((n) => n.id !== id),
        currentNote: null,
      });
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to restore note:", e);
    }
  },

  permanentDeleteNote: async (id) => {
    try {
      await api.deleteNote(id);
      const { notes, trashNotes, currentNote } = get();
      set({
        notes: notes.filter((n) => n.id !== id),
        trashNotes: trashNotes.filter((n) => n.id !== id),
        currentNote: currentNote?.id === id ? null : currentNote,
      });
      get().aggregateTasks();
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to permanently delete note:", e);
    }
  },

  emptyTrash: async () => {
    try {
      const { trashNotes } = get();
      for (const note of trashNotes) {
        await api.deleteNote(note.id);
      }
      set({ trashNotes: [] });
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to empty trash:", e);
    }
  },

  toggleStatus: async (id) => {
    try {
      const updated = await api.toggleNoteStatus(id);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
    } catch (e) {
      console.error("Failed to toggle status:", e);
    }
  },

  setPriority: async (id, priority) => {
    try {
      const updated = await api.setNotePriority(id, priority);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
    } catch (e) {
      console.error("Failed to set priority:", e);
    }
  },

  toggleStarred: async (id, starred) => {
    try {
      const updated = await api.setNoteStarred(id, starred);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
    } catch (e) {
      console.error("Failed to toggle starred:", e);
    }
  },

  togglePinned: async (id, pinned) => {
    try {
      const updated = await api.setNotePinned(id, pinned);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
    } catch (e) {
      console.error("Failed to toggle pinned:", e);
    }
  },

  setTags: async (id, tags) => {
    try {
      const updated = await api.setNoteTags(id, tags);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
      await get().loadTags();
    } catch (e) {
      console.error("Failed to set tags:", e);
    }
  },

  setDueDate: async (id, dueDate) => {
    try {
      const updated = await api.setNoteDueDate(id, dueDate);
      const { notes, currentNote } = get();
      set({
        notes: notes.map((n) => (n.id === id ? updated : n)),
        currentNote: currentNote?.id === id ? updated : currentNote,
      });
    } catch (e) {
      console.error("Failed to set due date:", e);
    }
  },

  setSelectedFolder: (folderId) => set({ selectedFolderId: folderId }),

  setFilterMode: (mode) => set({ filterMode: mode }),

  setGraphViewOpen: (open) => set({ graphViewOpen: open }),
  setDailyViewMode: (mode) => set({ dailyViewMode: mode }),

  createFolder: async (name, color, parentId) => {
    try {
      await api.createFolder(name, color, parentId);
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to create folder:", e);
    }
  },

  deleteFolder: async (folderId) => {
    try {
      await api.deleteFolder(folderId);
      await get().loadFolders();
      await get().loadFolderNoteCounts();
      const { selectedFolderId } = get();
      if (selectedFolderId === folderId) {
        set({ selectedFolderId: null, filterMode: "all" });
        await get().loadNotes();
      }
    } catch (e) {
      console.error("Failed to delete folder:", e);
    }
  },

  updateFolder: async (folderId, name, color, parentId) => {
    try {
      await api.updateFolder(folderId, name, color, parentId);
      await get().loadFolders();
    } catch (e) {
      console.error("Failed to update folder:", e);
    }
  },

  updateNoteFolder: async (noteId, folderId) => {
    try {
      const updated = await api.updateNote({ id: noteId, folder_id: folderId });
      const { notes, currentNote, selectedFolderId } = get();
      set({ notes: notes.map((n) => (n.id === noteId ? updated : n)) });
      if (currentNote?.id === noteId) {
        set({ currentNote: updated });
      }
      const oldFolderId = currentNote?.id === noteId ? currentNote.folder_id : null;
      // 如果当前浏览的是原文件夹或目标文件夹，刷新列表以保持一致
      if (selectedFolderId === folderId || selectedFolderId === oldFolderId) {
        await get().loadNotes(selectedFolderId || undefined);
      }
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to update note folder:", e);
    }
  },

  importNoteFromMd: async (filePath) => {
    try {
      const folderId = get().selectedFolderId;
      const note = await api.importNoteFromMd(filePath, folderId || undefined);
      set({ currentNote: note, currentNoteContent: note.content, isNewNote: false });
      await get().loadTags();
      await get().loadFolderNoteCounts();
    } catch (e) {
      console.error("Failed to import note:", e);
      throw e;
    }
  },

  openDailyNote: async (date) => {
    try {
      const targetDate = date || toLocalDate(new Date());
      const note = await api.getDailyNote(targetDate);
      if (note) {
        set({ dailyNote: note, dailyDate: targetDate, currentNote: note, currentNoteContent: note.content, isNewNote: false });
      } else {
        // 没有日志，清空内容页面
        set({ dailyNote: null, dailyDate: targetDate, currentNote: null, currentNoteContent: "", isNewNote: false });
      }
    } catch (e) {
      console.error("Failed to open daily note:", e);
    }
  },

  createDailyNote: async (date) => {
    try {
      const targetDate = date || toLocalDate(new Date());
      // 使用 getOrCreateDailyNote：已有则获取，软删除则恢复，真正不存在才创建
      const note = await api.getOrCreateDailyNote(targetDate);
      set({ dailyNote: note, dailyDate: targetDate, currentNote: note, currentNoteContent: note.content, isNewNote: false });
      await get().loadDailyJournals();
    } catch (e) {
      console.error("Failed to create daily note:", e);
    }
  },

  navigateDaily: async (offset) => {
    const { dailyDate } = get();
    const d = new Date(dailyDate + "T00:00:00");
    d.setDate(d.getDate() + offset);
    const newDate = toLocalDate(d);
    await get().openDailyNote(newDate);
  },
}));
