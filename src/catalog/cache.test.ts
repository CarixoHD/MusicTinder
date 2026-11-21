import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_KEY, CACHE_LIMIT, CACHE_TTL_MS, cached, readCache, writeCache } from './cache';

const storedEntries = (): Record<string, unknown> => {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw === null) return {};
  const parsed = JSON.parse(raw) as { entries: Record<string, unknown> };
  return parsed.entries;
};

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('catalog cache', () => {
  it('round-trips a value under the mt:v1 namespace', () => {
    writeCache('lookup:a', { answer: 42 });

    expect(readCache('lookup:a')).toEqual({ answer: 42 });
    expect(CACHE_KEY.startsWith('mt:v1')).toBe(true);
    expect(localStorage.length).toBe(1);
  });

  it('serves a cached loader result without calling the loader again within 24 h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const load = vi.fn(async () => 'fresh');

    expect(await cached('k', load)).toBe('fresh');
    vi.setSystemTime(new Date('2026-01-01T23:59:00Z'));
    expect(await cached('k', load)).toBe('fresh');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('expires an entry after 24 h and refetches it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const load = vi.fn(async () => 'fresh');

    await cached('k', load);
    vi.setSystemTime(new Date(Date.now() + CACHE_TTL_MS + 1));
    await cached('k', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never holds more than the cap and evicts the least recently used entry', () => {
    vi.useFakeTimers();
    const base = Date.parse('2026-01-01T00:00:00Z');
    const at = (offset: number) => vi.setSystemTime(new Date(base + offset));

    for (let i = 0; i < CACHE_LIMIT; i += 1) {
      at(i);
      writeCache(`k${i}`, i);
    }
    at(CACHE_LIMIT);
    expect(readCache('k0')).toBe(0); // k0 is now the most recently used.
    at(CACHE_LIMIT + 1);
    writeCache('extra', 'x');

    expect(Object.keys(storedEntries())).toHaveLength(CACHE_LIMIT);
    expect(readCache('k0')).toBe(0);
    expect(readCache('k1')).toBeUndefined();
    expect(readCache('extra')).toBe('x');
  });

  it('treats a corrupt stored blob as a cold cache', () => {
    localStorage.setItem(CACHE_KEY, '{not json');

    expect(readCache('k')).toBeUndefined();
    writeCache('k', 1);
    expect(readCache('k')).toBe(1);
  });
});
