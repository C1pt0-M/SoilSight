import { create } from 'zustand';
import type { ClickResult } from '../models/shi';

type ResultStatus = 'idle' | 'loading' | 'evaluated' | 'not_evaluated' | 'outside_aoi' | 'error';

interface ResultState {
  status: ResultStatus;
  currentResult: ClickResult | null;
  lastError: string | null;
  history: ClickResult[];
  setStatus: (status: ResultStatus) => void;
  setCurrentResult: (result: ClickResult | null) => void;
  setLastError: (error: string | null) => void;
  addHistory: (result: ClickResult) => void;
  clearHistory: () => void;
}

export const useResultStore = create<ResultState>((set) => ({
  status: 'idle',
  currentResult: null,
  lastError: null,
  history: [],
  setStatus: (status) => set({ status }),
  setCurrentResult: (currentResult) => set({ currentResult }),
  setLastError: (lastError) => set({ lastError }),
  addHistory: (result) => set((state) => ({
    history: [result, ...state.history].slice(0, 10), // Limit to 10 entries as suggested
  })),
  clearHistory: () => set({ history: [] }),
}));
