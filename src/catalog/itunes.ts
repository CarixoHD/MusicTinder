import { normalizeGenre } from '../chips';
import {
  CatalogError,
  type Chip,
  type SeedCandidate,
  type SeedSearchOptions,
} from '../types';
import { withItunesBudget } from './budget';
import { cached } from './cache';
import { searchDeezerArtists } from './deezerSeeds';

const SEARCH_URL = 'https://itunes.apple.com/search';
const SEED_LIMIT = 8;

/** iTunes serves 100 px artwork; the app's lists and cards need a 600 px square. */
const upscaleArtwork = (url: string) => url.replace('/100x100bb.', '/600x600bb.');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const chipsOf = (genre: unknown): Chip[] =>
  typeof genre === 'string' && genre.trim() !== '' ? normalizeGenre(genre) : ['other'];

// Network boundary: the payload is untrusted, so each field used is checked
// before it becomes a SeedCandidate. Unreadable rows are dropped, not guessed.
function toCandidate(item: unknown, type: 'artist' | 'album'): SeedCandidate | null {
  if (!isRecord(item)) return null;

  if (type === 'artist') {
    const { artistId, artistName } = item;
    if (typeof artistId !== 'number' || typeof artistName !== 'string') return null;
    return {
      itunesId: artistId,
      kind: 'artist',
      name: artistName,
      creator: artistName,
      image: typeof item.artworkUrl100 === 'string' ? upscaleArtwork(item.artworkUrl100) : undefined,
      chips: chipsOf(item.primaryGenreName),
    };
  }

  const { collectionId, collectionName, artistName, releaseDate } = item;
  if (typeof collectionId !== 'number' || typeof collectionName !== 'string') return null;
  const year = typeof releaseDate === 'string' ? Number(releaseDate.slice(0, 4)) : NaN;
  return {
    itunesId: collectionId,
    kind: 'album',
    name: collectionName,
    creator: typeof artistName === 'string' ? artistName : collectionName,
    year: Number.isFinite(year) ? year : undefined,
    image: typeof item.artworkUrl100 === 'string' ? upscaleArtwork(item.artworkUrl100) : undefined,
    chips: chipsOf(item.primaryGenreName),
  };
}

async function fetchSearch(url: URL, term: string): Promise<SeedCandidate[]> {
  let body: unknown;
  try {
    const response = await fetch(url);
    // Apple answers an exhausted per-IP budget with 403 or 429.
    if (response.status === 403 || response.status === 429) {
      throw new CatalogError('rate', `iTunes rate limit reached (${response.status})`);
    }
    if (!response.ok) throw new Error(`iTunes search answered ${response.status}`);
    body = await response.json();
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError('network', `Could not search the catalog for "${term}"`);
  }

  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
  return results;
}

/**
 * Artist/album seed search against the iTunes Search API (CORS `*`).
 * Responses are cached for 24 h and every request spends one token from the
 * shared budget. Without options a search fails fast as a rate error, which is
 * what generation's genre anchors want. Setup passes `wait` so it holds its
 * loading state through a cool-down; an artist search Apple then refuses (or
 * one that never gets a token) falls back to Deezer's artist search.
 */
export async function searchSeeds(
  term: string,
  type: 'artist' | 'album',
  options: SeedSearchOptions = {},
): Promise<SeedCandidate[]> {
  const trimmed = term.trim();
  const url = new URL(SEARCH_URL);
  url.searchParams.set('term', trimmed);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', type === 'artist' ? 'musicArtist' : 'album');
  url.searchParams.set('limit', String(SEED_LIMIT));

  // An abandoned wait belongs to a term nobody wants any more: ask nobody.
  const wantsFallback = options.wait === true && type === 'artist';
  const canFallBack = () => wantsFallback && options.signal?.aborted !== true;

  let candidates: SeedCandidate[] | null;
  try {
    candidates = await cached(url.toString(), () =>
      withItunesBudget<SeedCandidate[] | null>(
        null,
        async () => {
          const results = await fetchSearch(url, trimmed);
          return results
            .map((item) => toCandidate(item, type))
            .filter((candidate): candidate is SeedCandidate => candidate !== null);
        },
        { wait: options.wait ?? false, priority: options.wait ?? false, signal: options.signal },
      ),
    );
  } catch (error) {
    if (canFallBack() && error instanceof CatalogError && error.kind === 'rate') {
      return searchDeezerArtists(trimmed);
    }
    throw error;
  }

  if (candidates !== null) return candidates;
  // No token after the wait (Setup abandoned it, or the bucket was reset).
  if (canFallBack()) return searchDeezerArtists(trimmed);
  throw new CatalogError('rate', 'iTunes search is cooling down');
}
