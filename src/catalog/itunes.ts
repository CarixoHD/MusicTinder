import { normalizeGenre } from '../chips';
import { CatalogError, type Chip, type SeedCandidate } from '../types';

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

/**
 * Artist/album seed search against the iTunes Search API (CORS `*`, 24 h cache).
 * Any transport or status failure surfaces as a typed network CatalogError so
 * Setup can offer an inline retry.
 */
export async function searchSeeds(
  term: string,
  type: 'artist' | 'album',
): Promise<SeedCandidate[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('term', term.trim());
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', type === 'artist' ? 'musicArtist' : 'album');
  url.searchParams.set('limit', String(SEED_LIMIT));

  let body: unknown;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`iTunes search answered ${response.status}`);
    body = await response.json();
  } catch {
    throw new CatalogError('network', `Could not search the catalog for "${term.trim()}"`);
  }

  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
  return results
    .map((item) => toCandidate(item, type))
    .filter((candidate): candidate is SeedCandidate => candidate !== null);
}
