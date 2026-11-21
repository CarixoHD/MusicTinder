import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LikedItem, Seed } from '../types';
import { SEEN_LIMIT } from './store';

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
