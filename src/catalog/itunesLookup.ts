import { normalizeGenre } from '../chips';
import { CatalogError, type Card, type Chip } from '../types';
import { withItunesBudget } from './budget';
import { cached } from './cache';

/**
 * iTunes Search/Lookup adapter for artist enrichment and song/album cards.
 * Every request is cached for 24 h and spends one token from the shared budget;
 * a cool-down returns un-enriched results rather than waiting or throwing.
 */

const ITUNES_API = 'https://itunes.apple.com';

interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  artistId?: number;
  artistName?: string;
  collectionId?: number;
  collectionName?: string;
  trackId?: number;
  trackName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesResult[];
}

/** Normalised lower-case name so iTunes and Deezer agree (see FakeCatalog). */
const creatorKey = (name: string) => name.trim().toLowerCase();

/** Search hits are ranked; prefer the exact name over a tribute or cover act. */
const nameScore = (query: string, name: string): number => {
  const q = creatorKey(query);
  const n = creatorKey(name);
  if (!q || !n) return 0;
  if (q === n) return 2;
  return n.includes(q) || q.includes(n) ? 1 : 0;
};

const chipsOf = (result: ItunesResult): Chip[] =>
  result.primaryGenreName ? normalizeGenre(result.primaryGenreName) : [];

/** Apple hands out 100px artwork; the card shows it at 600px. */
const artwork600 = (url?: string): string | undefined => url?.replace(/\/\d+x\d+bb\./, '/600x600bb.');

const PREVIEW_LIMIT = 5;

const albumIdOf = (key: string): number | undefined => {
  const match = /^it:album:(\d+)$/.exec(key);
  return match ? Number(match[1]) : undefined;
};

const yearOf = (releaseDate?: string): number | undefined => {
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : Number.NaN;
  return Number.isFinite(year) ? year : undefined;
};

/** Apple Music links arrive with a `uo=4` tracking parameter; the app keeps it clean. */
const withoutTracking = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('uo');
    return parsed.toString();
  } catch {
    return url;
  }
};

async function fetchResults(url: string): Promise<ItunesResult[]> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new CatalogError('network', `iTunes request failed (${url})`);
  }

  // Apple answers an exhausted per-IP budget with 403 or 429.
  if (response.status === 403 || response.status === 429) {
    throw new CatalogError('rate', `iTunes rate limit reached (${response.status})`);
  }
  if (!response.ok) {
    throw new CatalogError('network', `iTunes request failed (${response.status})`);
  }

  try {
    // Network payload boundary: the Search API's documented response shape.
    const payload = (await response.json()) as ItunesResponse;
    return payload.results ?? [];
  } catch {
    throw new CatalogError('network', `iTunes returned an unreadable response (${url})`);
  }
}

/** `null` means the budget is cooling down: no token was spent and no fetch ran. */
function lookupResults(path: string, reserve = 0): Promise<ItunesResult[] | null> {
  const url = `${ITUNES_API}${path}`;
  return cached(url, () =>
    withItunesBudget<ItunesResult[] | null>(null, () => fetchResults(url), reserve),
  );
}

/**
 * A dealt album card resolves its preview with a follow-up song lookup, and the
 * first two cards ask for one right after the deck deals. Album enrichment leaves
 * these two tokens unspent, otherwise a fresh Albums deck spends the whole budget
 * dealing and its first card can never find a sample. Song cards already carry
 * their preview, so their lookups reserve nothing.
 */
const SAMPLE_RESERVE = 2;

export async function enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
  const results = await lookupResults(
    `/search?term=${encodeURIComponent(name)}&media=music&entity=musicArtist&limit=5`,
    SAMPLE_RESERVE,
  );
  if (results === null) return null;

  let bestId: number | null = null;
  let bestChips: Chip[] = [];
  let bestScore = 0;
  for (const result of results) {
    const artistId = result.artistId;
    if (artistId === undefined) continue;
    const score = nameScore(name, result.artistName ?? '');
    if (score > bestScore) {
      bestId = artistId;
      bestChips = chipsOf(result);
      bestScore = score;
    }
  }
  return bestId === null ? null : { itunesArtistId: bestId, chips: bestChips };
}

export async function artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
  const results = await lookupResults(`/lookup?id=${itunesArtistId}&entity=song&limit=${limit}`);
  if (results === null) return [];
  if (results.length === 0) {
    throw new CatalogError('notfound', `iTunes has no artist ${itunesArtistId}`);
  }

  return results
    .filter((result) => result.kind === 'song' && result.trackId !== undefined)
    .slice(0, limit)
    .map(
      (result): Card => ({
        key: `it:track:${result.trackId}`,
        kind: 'song',
        source: 'itunes',
        title: result.trackName ?? '',
        creator: result.artistName ?? '',
        creatorKey: creatorKey(result.artistName ?? ''),
        year: yearOf(result.releaseDate),
        image: artwork600(result.artworkUrl100),
        previewUrl: result.previewUrl,
        appleUrl: withoutTracking(result.trackViewUrl),
        chips: chipsOf(result),
      }),
    );
}

export async function artistAlbums(itunesArtistId: number, limit: number): Promise<Card[]> {
  const results = await lookupResults(
    `/lookup?id=${itunesArtistId}&entity=album&limit=${limit}`,
    SAMPLE_RESERVE,
  );
  if (results === null) return [];
  if (results.length === 0) {
    throw new CatalogError('notfound', `iTunes has no artist ${itunesArtistId}`);
  }

  return results
    .filter((result) => result.wrapperType === 'collection' && result.collectionId !== undefined)
    .slice(0, limit)
    .map(
      (result): Card => ({
        key: `it:album:${result.collectionId}`,
        kind: 'album',
        source: 'itunes',
        title: result.collectionName ?? '',
        creator: result.artistName ?? '',
        creatorKey: creatorKey(result.artistName ?? ''),
        year: yearOf(result.releaseDate),
        image: artwork600(result.artworkUrl100),
        appleUrl: withoutTracking(result.collectionViewUrl),
        chips: chipsOf(result),
      }),
    );
}

/**
 * Just-in-time sample for a card the catalog ships without one: an album's
 * song lookup, or a song search for an artist. Fire-and-forget, so every
 * failure (cool-down, offline, no match) is the card's existing "no sample"
 * state rather than an error. Song cards already carry theirs.
 */
export async function samplePreview(card: Card): Promise<string | undefined> {
  if (card.kind === 'song') return card.previewUrl;

  try {
    if (card.kind === 'album') {
      const id = albumIdOf(card.key);
      if (id === undefined) return undefined;
      const songs = await lookupResults(`/lookup?id=${id}&entity=song&limit=${PREVIEW_LIMIT}`);
      return songs?.find((song) => song.previewUrl)?.previewUrl;
    }

    const results = await lookupResults(
      `/search?term=${encodeURIComponent(card.creator)}&media=music&entity=song&limit=${PREVIEW_LIMIT}`,
    );
    return results?.find(
      (result) => result.previewUrl && nameScore(card.creator, result.artistName ?? '') > 0,
    )?.previewUrl;
  } catch {
    // Network failure or an exhausted budget: the card reads "No sample".
    return undefined;
  }
}
