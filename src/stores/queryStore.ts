import { create } from "zustand";
import { QueryParams, NoteRow, api } from "../lib/tauri";

interface QueryState {
  params: QueryParams;
  results: NoteRow[];
  showQueryPanel: boolean;
  querying: boolean;

  setKeyword: (keyword: string) => void;
  setDateRange: (from: number | undefined, to: number | undefined) => void;
  setTagIds: (tagIds: string[]) => void;
  togglePriority: (priority: string) => void;
  setPriorities: (priorities: string[]) => void;
  setStatus: (status: string | undefined) => void;
  setNoteType: (noteType: string | undefined) => void;
  setStarredOnly: (starred: boolean) => void;
  toggleQueryPanel: () => void;
  setQueryPanel: (show: boolean) => void;
  resetParams: () => void;
  executeQuery: () => Promise<void>;
}

const defaultParams: QueryParams = {
  keyword: undefined,
  date_from: undefined,
  date_to: undefined,
  tag_ids: [],
  priorities: [],
  status: undefined,
  note_type: undefined,
  starred_only: false,
};

export const useQueryStore = create<QueryState>((set, get) => ({
  params: { ...defaultParams },
  results: [],
  showQueryPanel: false,
  querying: false,

  setKeyword: (keyword) =>
    set((s) => ({ params: { ...s.params, keyword: keyword || undefined } })),

  setDateRange: (from, to) =>
    set((s) => ({ params: { ...s.params, date_from: from, date_to: to } })),

  setTagIds: (tagIds) =>
    set((s) => ({ params: { ...s.params, tag_ids: tagIds } })),

  togglePriority: (priority) =>
    set((s) => {
      const priorities = s.params.priorities.includes(priority)
        ? s.params.priorities.filter((p) => p !== priority)
        : [...s.params.priorities, priority];
      return { params: { ...s.params, priorities } };
    }),

  setPriorities: (priorities) =>
    set((s) => ({ params: { ...s.params, priorities } })),

  setStatus: (status) =>
    set((s) => ({ params: { ...s.params, status } })),

  setNoteType: (noteType) =>
    set((s) => ({ params: { ...s.params, note_type: noteType } })),

  setStarredOnly: (starred) =>
    set((s) => ({ params: { ...s.params, starred_only: starred } })),

  toggleQueryPanel: () => set((s) => ({ showQueryPanel: !s.showQueryPanel })),
  setQueryPanel: (show) => set({ showQueryPanel: show }),

  resetParams: () => set({ params: { ...defaultParams }, results: [] }),

  executeQuery: async () => {
    set({ querying: true });
    try {
      const results = await api.queryNotes(get().params);
      set({ results, querying: false });
    } catch (e) {
      console.error("Query failed:", e);
      set({ querying: false, results: [] });
    }
  },
}));
