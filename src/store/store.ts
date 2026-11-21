import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { CHIPS } from '../chips';
import type { CardKind, Chip, LikedItem, Seed, SeedKind, Settings, TasteWeights } from '../types';

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
  /** Set when saved data had to be repaired on load; runtime-only, never persisted. */
  storageNotice: string | null;
  /** Bumped by resetAll() so session-held decks can never match data from before the wipe. */
  sessionEpoch: number;
  addSeed: (seed: Seed) => void;
  removeSeed: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setTaste: (taste: TasteWeights) => void;
  addLiked: (item: LikedItem) => void;
  markSeen: (key: string) => void;
  setScreen: (screen: Screen) => void;
  setSettingsOpen: (open: boolean) => void;
  dismissStorageNotice: () => void;
  resetAll: () => void;
}

export const STORAGE_KEY = 'mt:v1';
const STORAGE_VERSION = 1;
export const SEEN_LIMIT = 5000;
export const STORAGE_NOTICE = 'Some saved data couldn’t be read, so it was reset.';

const defaultSettings = (): Settings => ({
  musicApp: 'spotify',
  sound: true,
  theme: 'system',
  cardType: 'artist',
});

const defaultTaste = (): TasteWeights => ({ chips: {}, creators: {}, origins: {} });

type PersistedState = Pick<AppState, 'seeds' | 'settings' | 'taste' | 'liked' | 'seen'>;
/** Collects whether a slice had to drop or replace anything while being read. */
type ReadReport = { recovered: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A persisted container must be an object, not an array or a primitive. */
const isContainer = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value);

const CHIP_IDS = new Set<string>(CHIPS.map((chip) => chip.id));
const isChip = (value: unknown): value is Chip => typeof value === 'string' && CHIP_IDS.has(value);

const SEED_KINDS: readonly SeedKind[] = ['artist', 'album', 'genre'];
const CARD_KINDS: readonly CardKind[] = ['artist', 'album', 'song'];
const MUSIC_APPS: readonly Settings['musicApp'][] = ['spotify', 'apple', 'ytmusic'];
const THEMES: readonly Settings['theme'][] = ['system', 'dark', 'light'];

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
// break the app on launch. Shape is validated per slice in readPersisted().
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

function writePersisted(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: STORAGE_VERSION }));
}

function readOptionalNumber(value: unknown, read: ReadReport): number | undefined {
  if (value === undefined) return undefined;
  if (isFiniteNumber(value)) return value;
  read.recovered = true;
  return undefined;
}

function readOptionalString(value: unknown, read: ReadReport): string | undefined {
  if (value === undefined) return undefined;
  if (isString(value)) return value;
  read.recovered = true;
  return undefined;
}

function readChips(value: unknown, read: ReadReport): Chip[] {
  if (!Array.isArray(value)) {
    read.recovered = true;
    return [];
  }
  const chips = value.filter(isChip);
  if (chips.length !== value.length) read.recovered = true;
  return chips;
}

function readSeed(value: unknown, read: ReadReport): Seed | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) {
    read.recovered = true;
    return null;
  }
  if (!isOneOf(SEED_KINDS, value.kind) || !Array.isArray(value.chips)) {
    read.recovered = true;
    return null;
  }
  const seed: Seed = {
    id: value.id,
    kind: value.kind,
    name: value.name,
    chips: readChips(value.chips, read),
  };
  const itunesArtistId = readOptionalNumber(value.itunesArtistId, read);
  if (itunesArtistId !== undefined) seed.itunesArtistId = itunesArtistId;
  const deezerArtistId = readOptionalNumber(value.deezerArtistId, read);
  if (deezerArtistId !== undefined) seed.deezerArtistId = deezerArtistId;
  const itunesCollectionId = readOptionalNumber(value.itunesCollectionId, read);
  if (itunesCollectionId !== undefined) seed.itunesCollectionId = itunesCollectionId;
  const creatorKey = readOptionalString(value.creatorKey, read);
  if (creatorKey !== undefined) seed.creatorKey = creatorKey;
  const image = readOptionalString(value.image, read);
  if (image !== undefined) seed.image = image;
  return seed;
}

function readLiked(value: unknown, read: ReadReport): LikedItem | null {
  if (
    !isRecord(value) ||
    !isString(value.key) ||
    !isOneOf(CARD_KINDS, value.kind) ||
    !isString(value.title) ||
    !isString(value.creator) ||
    !isString(value.creatorKey) ||
    !Array.isArray(value.chips)
  ) {
    read.recovered = true;
    return null;
  }
  const item: LikedItem = {
    key: value.key,
    kind: value.kind,
    title: value.title,
    creator: value.creator,
    creatorKey: value.creatorKey,
    chips: readChips(value.chips, read),
  };
  const year = readOptionalNumber(value.year, read);
  if (year !== undefined) item.year = year;
  const image = readOptionalString(value.image, read);
  if (image !== undefined) item.image = image;
  const previewUrl = readOptionalString(value.previewUrl, read);
  if (previewUrl !== undefined) item.previewUrl = previewUrl;
  const appleUrl = readOptionalString(value.appleUrl, read);
  if (appleUrl !== undefined) item.appleUrl = appleUrl;
  const because = readOptionalString(value.because, read);
  if (because !== undefined) item.because = because;
  return item;
}

function readList<T>(
  value: unknown,
  read: ReadReport,
  readItem: (item: unknown, report: ReadReport) => T | null,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    read.recovered = true;
    return [];
  }
  const items: T[] = [];
  for (const entry of value) {
    const item = readItem(entry, read);
    if (item !== null) items.push(item);
  }
  return items;
}

function readSettings(value: unknown, read: ReadReport): Settings {
  const settings = defaultSettings();
  if (value === undefined) return settings;
  if (!isContainer(value)) {
    read.recovered = true;
    return settings;
  }
  if (isOneOf(MUSIC_APPS, value.musicApp)) settings.musicApp = value.musicApp;
  else if (value.musicApp !== undefined) read.recovered = true;
  if (typeof value.sound === 'boolean') settings.sound = value.sound;
  else if (value.sound !== undefined) read.recovered = true;
  if (isOneOf(THEMES, value.theme)) settings.theme = value.theme;
  else if (value.theme !== undefined) read.recovered = true;
  if (isOneOf(CARD_KINDS, value.cardType)) settings.cardType = value.cardType;
  else if (value.cardType !== undefined) read.recovered = true;
  return settings;
}

function readTaste(value: unknown, read: ReadReport): TasteWeights {
  const taste = defaultTaste();
  if (value === undefined) return taste;
  if (!isContainer(value)) {
    read.recovered = true;
    return taste;
  }
  if (isContainer(value.chips)) {
    for (const [chip, weight] of Object.entries(value.chips)) {
      if (isChip(chip) && isFiniteNumber(weight)) taste.chips[chip] = weight;
      else read.recovered = true;
    }
  } else if (value.chips !== undefined) read.recovered = true;
  if (isContainer(value.creators)) {
    for (const [creator, weight] of Object.entries(value.creators)) {
      if (isFiniteNumber(weight)) taste.creators[creator] = weight;
      else read.recovered = true;
    }
  } else if (value.creators !== undefined) read.recovered = true;
  if (isContainer(value.origins)) {
    for (const [feature, origin] of Object.entries(value.origins)) {
      if (isString(origin)) taste.origins[feature] = origin;
      else read.recovered = true;
    }
  } else if (value.origins !== undefined) read.recovered = true;
  return taste;
}

function readSeen(value: unknown, read: ReadReport): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    read.recovered = true;
    return [];
  }
  const keys = value.filter(isString);
  if (keys.length !== value.length) read.recovered = true;
  return keys.slice(-SEEN_LIMIT);
}

/** Validates every persisted slice; anything malformed falls back to its default. */
function readPersisted(raw: unknown, read: ReadReport): PersistedState {
  // merge() also runs for a first launch, where nothing was ever stored.
  if (raw === undefined) {
    return { seeds: [], settings: defaultSettings(), taste: defaultTaste(), liked: [], seen: [] };
  }
  let source: Record<string, unknown> = {};
  if (isContainer(raw)) source = raw;
  else read.recovered = true;
  return {
    seeds: readList(source.seeds, read, readSeed),
    settings: readSettings(source.settings, read),
    taste: readTaste(source.taste, read),
    liked: readList(source.liked, read, readLiked),
    seen: readSeen(source.seen, read),
  };
}

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
      storageNotice: null,
      sessionEpoch: 0,

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
      dismissStorageNotice: () => set({ storageNotice: null }),
      resetAll: () => {
        // resetAll clears every mt:v1.* key, then writes defaults back.
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const key = localStorage.key(i);
          if (key?.startsWith(STORAGE_KEY)) localStorage.removeItem(key);
        }
        set((state) => ({
          seeds: [],
          settings: defaultSettings(),
          taste: defaultTaste(),
          liked: [],
          seen: [],
          screen: 'setup',
          settingsOpen: false,
          storageNotice: null,
          sessionEpoch: state.sessionEpoch + 1,
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state): PersistedState => ({
        seeds: state.seeds,
        settings: state.settings,
        taste: state.taste,
        liked: state.liked,
        seen: state.seen,
      }),
      // merge() validates every slice, so this cast only hands the raw value
      // through the persisted-state seam; nothing unchecked reaches the store.
      migrate: (persistedState) => persistedState as PersistedState,
      merge: (persistedState, currentState) => {
        const read: ReadReport = { recovered: false };
        const state = readPersisted(persistedState, read);
        if (!read.recovered) return { ...currentState, ...state };
        // Overwrite the bad value so the next launch starts clean.
        writePersisted(state);
        return { ...currentState, ...state, storageNotice: STORAGE_NOTICE };
      },
    },
  ),
);
