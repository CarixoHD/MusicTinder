import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LikedItem, Seed } from '../types';
import { SEEN_LIMIT, STORAGE_NOTICE } from './store';

const SEED: Seed = {
  id: 'seed-1',
  kind: 'artist',
  name: 'Ada Vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
  creatorKey: 'ada vale',
};

const LIKED: LikedItem = {
  key: 'dz:artist:5101',
  kind: 'artist',
  title: 'Glass Harbour',
  creator: 'Glass Harbour',
  creatorKey: 'glass harbour',
  image: 'https://cdn.example.test/artists/5101.jpg',
  chips: ['electronic'],
  because: 'Ada Vale',
};

/** Simulates a page reload: a fresh module reading the same localStorage. */
async function reloadStore() {
  vi.resetModules();
  const { useStore } = await import('./store');
  return useStore;
}

/** Writes a persisted payload exactly as an older/broken build might have left it. */
function writePersisted(state: unknown): void {
  localStorage.setItem('mt:v1', JSON.stringify({ state, version: 1 }));
}

function readPersisted(): { state: Record<string, unknown> } {
  return JSON.parse(localStorage.getItem('mt:v1') ?? '{}') as { state: Record<string, unknown> };
}

const DEFAULTS = {
  settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType: 'artist' },
  taste: { chips: {}, creators: {}, origins: {} },
};

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('store persistence', () => {
  it('round-trips seeds, settings, taste, liked and seen across a reload', async () => {
    const store = await reloadStore();
    store.getState().addSeed(SEED);
    store.getState().setSettings({ musicApp: 'apple', sound: false, theme: 'dark' });
    store.getState().setTaste({
      chips: { electronic: 1.5 },
      creators: { 'ada vale': 1 },
      origins: { electronic: 'Ada Vale' },
    });
    store.getState().addLiked(LIKED);
    store.getState().markSeen('it:track:1');
    store.getState().setScreen('liked');
    store.getState().setSettingsOpen(true);

    const reloaded = await reloadStore();
    const state = reloaded.getState();

    expect(state.seeds).toEqual([SEED]);
    expect(state.settings).toEqual({
      musicApp: 'apple',
      sound: false,
      theme: 'dark',
      cardType: 'artist',
    });
    expect(state.taste).toEqual({
      chips: { electronic: 1.5 },
      creators: { 'ada vale': 1 },
      origins: { electronic: 'Ada Vale' },
    });
    expect(state.liked).toEqual([LIKED]);
    expect(state.seen).toEqual(['it:track:1']);
    expect(state.storageNotice).toBeNull();
  });

  it('falls back to defaults for null or wrongly typed slices instead of crashing', async () => {
    writePersisted({ seeds: null, settings: {}, taste: 'nope', liked: {}, seen: 'it:track:1' });

    const store = await reloadStore();
    const state = store.getState();

    expect(state.seeds).toEqual([]);
    expect(state.taste).toEqual(DEFAULTS.taste);
    expect(state.liked).toEqual([]);
    expect(state.seen).toEqual([]);
    // Actions still work on the defaulted slices, so the app renders and reacts.
    state.addSeed(SEED);
    expect(store.getState().seeds).toEqual([SEED]);
  });

  it('falls back to defaults when the whole persisted state is null', async () => {
    writePersisted(null);

    const store = await reloadStore();

    expect(store.getState().seeds).toEqual([]);
    expect(store.getState().settings).toEqual(DEFAULTS.settings);
    expect(store.getState().storageNotice).toBe(STORAGE_NOTICE);
  });

  it('treats a persisted state that is not an object as corrupt', async () => {
    writePersisted([SEED]);

    const store = await reloadStore();

    expect(store.getState().seeds).toEqual([]);
    expect(store.getState().storageNotice).toBe(STORAGE_NOTICE);
  });

  it('fills settings fields a saved partial object leaves out', async () => {
    writePersisted({ settings: { musicApp: 'apple' } });

    const store = await reloadStore();

    expect(store.getState().settings).toEqual({ ...DEFAULTS.settings, musicApp: 'apple' });
  });

  it('falls back per settings field when a saved value is unknown', async () => {
    writePersisted({ settings: { musicApp: 'napster', sound: 'yes', theme: 'neon', cardType: 'vinyl' } });

    const store = await reloadStore();

    expect(store.getState().settings).toEqual(DEFAULTS.settings);
  });

  it('keeps valid saved entries and drops broken ones', async () => {
    writePersisted({ seeds: [SEED, { id: 42 }], liked: [LIKED, null], seen: ['it:track:1', 7] });

    const store = await reloadStore();

    expect(store.getState().seeds).toEqual([SEED]);
    expect(store.getState().liked).toEqual([LIKED]);
    expect(store.getState().seen).toEqual(['it:track:1']);
  });

  it('repairs the stored value and shows a dismissible notice when saved data was reset', async () => {
    writePersisted({ seeds: null, settings: { musicApp: 'apple' } });

    const store = await reloadStore();

    expect(store.getState().storageNotice).toBe(STORAGE_NOTICE);
    expect(STORAGE_NOTICE).toMatch(/reset/);
    // The bad value is overwritten, so the next launch is clean.
    const stored = readPersisted();
    expect(stored.state.seeds).toEqual([]);
    expect(stored.state.settings).toEqual({ ...DEFAULTS.settings, musicApp: 'apple' });

    store.getState().dismissStorageNotice();
    expect(store.getState().storageNotice).toBeNull();

    const reloaded = await reloadStore();
    expect(reloaded.getState().storageNotice).toBeNull();
    expect(reloaded.getState().seeds).toEqual([]);
  });

  it('does not persist the screen or the settings sheet', async () => {
    const store = await reloadStore();
    store.getState().setScreen('liked');
    store.getState().setSettingsOpen(true);

    const reloaded = await reloadStore();
    expect(reloaded.getState().screen).toBe('setup');
    expect(reloaded.getState().settingsOpen).toBe(false);
  });

  it('lands on discovery after a reload when seeds exist', async () => {
    const store = await reloadStore();
    store.getState().addSeed(SEED);

    const reloaded = await reloadStore();
    expect(reloaded.getState().screen).toBe('discovery');
  });

  it('falls back to defaults when stored JSON is corrupt', async () => {
    localStorage.setItem('mt:v1', '{ not json');
    const store = await reloadStore();
    const state = store.getState();

    expect(state.seeds).toEqual([]);
    expect(state.settings).toEqual({
      musicApp: 'spotify',
      sound: true,
      theme: 'system',
      cardType: 'artist',
    });
    expect(state.taste).toEqual({ chips: {}, creators: {}, origins: {} });
    expect(state.liked).toEqual([]);
    expect(state.seen).toEqual([]);
    expect(state.screen).toBe('setup');
    expect(localStorage.getItem('mt:v1')).toBeNull();
  });

  it('caps seen keys at 5000, dropping the oldest', async () => {
    const store = await reloadStore();

    for (let i = 0; i < SEEN_LIMIT + 1; i += 1) store.getState().markSeen(`it:track:${i}`);

    const seen = store.getState().seen;
    expect(seen).toHaveLength(SEEN_LIMIT);
    expect(seen[0]).toBe('it:track:1');
    expect(seen.at(-1)).toBe(`it:track:${SEEN_LIMIT}`);
  });

  it('resetAll clears every mt:v1 key and restores defaults', async () => {
    const store = await reloadStore();
    store.getState().addSeed(SEED);
    store.getState().setScreen('liked');
    localStorage.setItem('mt:v1.cache', '{"stale":true}');

    store.getState().resetAll();

    expect(localStorage.getItem('mt:v1.cache')).toBeNull();
    expect(store.getState().seeds).toEqual([]);
    expect(store.getState().screen).toBe('setup');
  });
});
