import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { LikedItem, Seed, Settings, TasteWeights } from '../types';

export type Screen = 'setup' | 'discovery' | 'liked';

export interface AppState {
  seeds: Seed[];
  settings: Settings;
  taste: TasteWeights;
  liked: LikedItem[];
  /** Dealt card keys, oldest first, ring-capped at SEEN_LIMIT. */
  seen: string[];
  screen: Screen;
  settingsOpen: boolean;
  addSeed: (seed: Seed) => void;
  removeSeed: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setTaste: (taste: TasteWeights) => void;
  addLiked: (item: LikedItem) => void;
  markSeen: (key: string) => void;
  setScreen: (screen: Screen) => void;
  setSettingsOpen: (open: boolean) => void;
  resetAll: () => void;
}

export const STORAGE_KEY = 'mt:v1';
export const SEEN_LIMIT = 5000;

const defaultSettings = (): Settings => ({
  musicApp: 'spotify',
  sound: true,
  theme: 'system',
  cardType: 'artist',
});

const defaultTaste = (): TasteWeights => ({ chips: {}, creators: {}, origins: {} });

type PersistedState = Pick<AppState, 'seeds' | 'settings' | 'taste' | 'liked' | 'seen'>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A reload with seeds lands on Discovery; a fresh profile lands on Setup. */
function initialScreen(): Screen {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : null;
    const seeds = state && Array.isArray(state.seeds) ? state.seeds : [];
    return seeds.length > 0 ? 'discovery' : 'setup';
  } catch {
    return 'setup';
  }
}

// Persisted-state read seam: corrupt JSON must fall back to defaults, never
// break the app on launch.
const safeStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (raw === null) return null;
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      localStorage.removeItem(name);
      return null;
    }
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      seeds: [],
      settings: defaultSettings(),
      taste: defaultTaste(),
      liked: [],
      seen: [],
      screen: initialScreen(),
      settingsOpen: false,

      addSeed: (seed) => set((state) => ({ seeds: [...state.seeds, seed] })),
      removeSeed: (id) => set((state) => ({ seeds: state.seeds.filter((seed) => seed.id !== id) })),
      setSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
      setTaste: (taste) => set({ taste }),
      addLiked: (item) => set((state) => ({ liked: [...state.liked, item] })),
      markSeen: (key) =>
        set((state) => {
          const seen = state.seen.includes(key) ? state.seen : [...state.seen, key];
          return { seen: seen.slice(-SEEN_LIMIT) };
        }),
      setScreen: (screen) => set({ screen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      resetAll: () => {
        // resetAll clears every mt:v1.* key, then writes defaults back.
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i);
          if (key?.startsWith(STORAGE_KEY)) localStorage.removeItem(key);
        }
        set({
          seeds: [],
          settings: defaultSettings(),
          taste: defaultTaste(),
          liked: [],
          seen: [],
          screen: 'setup',
          settingsOpen: false,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state): PersistedState => ({
        seeds: state.seeds,
        settings: state.settings,
        taste: state.taste,
        liked: state.liked,
        seen: state.seen,
      }),
      // Schema v1 is the first persisted shape; v0 data (if any) matches it.
      migrate: (persistedState) => persistedState as PersistedState,
    },
  ),
);
