/**
 * localStorage response cache for the catalog adapters: 24 h freshness,
 * LRU-capped, quota-tolerant. Namespaced under mt:v1 so resetAll() clears it.
 */
export const CACHE_KEY = 'mt:v1.catalog';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_LIMIT = 300;

interface CacheEntry {
  /** When the response was stored; freshness is measured from here. */
  ts: number;
  /** Last read; eviction order. Separate from ts so reads do not extend the TTL. */
  used: number;
  value: unknown;
}

interface CacheState {
  entries: Record<string, CacheEntry>;
}

const isEntry = (value: unknown): value is CacheEntry =>
  typeof value === 'object' &&
  value !== null &&
  'ts' in value &&
  typeof value.ts === 'number' &&
  'used' in value &&
  typeof value.used === 'number' &&
  'value' in value;

const isState = (value: unknown): value is { entries: Record<string, unknown> } =>
  typeof value === 'object' && value !== null && 'entries' in value && typeof value.entries === 'object' && value.entries !== null;

const emptyState = (): CacheState => ({ entries: {} });

// Persisted-state read seam: corrupt or foreign JSON degrades to a cold cache.
function readState(): CacheState {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) return emptyState();

    const state = emptyState();
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (isEntry(entry)) state.entries[key] = entry;
    }
    return state;
  } catch {
    return emptyState();
  }
}

const byLastUse = (state: CacheState, keys: string[]): string[] =>
  keys.sort((a, b) => state.entries[a].used - state.entries[b].used);

function writeState(state: CacheState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    return;
  } catch {
    // Quota exceeded: shed the least-recently-used half and retry once.
  }

  const keys = byLastUse(state, Object.keys(state.entries));
  for (const key of keys.slice(0, Math.ceil(keys.length / 2))) delete state.entries[key];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: a cold cache is a valid degradation, never an error.
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // Nothing else to do: reads will miss.
    }
  }
}

export function readCache<T>(key: string): T | undefined {
  const state = readState();
  const entry = state.entries[key];
  if (entry === undefined) return undefined;

  const now = Date.now();
  if (now - entry.ts >= CACHE_TTL_MS) {
    delete state.entries[key];
    writeState(state);
    return undefined;
  }

  entry.used = now;
  writeState(state);
  // Cache seam: the stored value is the type the caller wrote under this key.
  return entry.value as T;
}

export function writeCache(key: string, value: unknown): void {
  const state = readState();
  const now = Date.now();
  state.entries[key] = { ts: now, used: now, value };

  const keys = Object.keys(state.entries);
  if (keys.length > CACHE_LIMIT) {
    for (const oldest of byLastUse(state, keys).slice(0, keys.length - CACHE_LIMIT)) {
      delete state.entries[oldest];
    }
  }
  writeState(state);
}

/** Serve `key` from cache, or run `load` once and store its result. */
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(key);
  if (hit !== undefined) return hit;

  const value = await load();
  // A null result is a cool-down signal from the budget, not a response worth caching.
  if (value !== null && value !== undefined) writeCache(key, value);
  return value;
}
