import { normalizeGenre } from '../chips';
import {
  CatalogError,
  type Card,
  type Chip,
  type LookupOptions,
  type ReleaseType,
  type Sample,
  type SampleOptions,
} from '../types';
import { withItunesBudget, type BudgetOptions } from './budget';
import { cached } from './cache';
import { artistTopPreview, deezerArtistIdOf, trackSearchPreview } from './deezer';

/**
 * iTunes Search/Lookup adapter for artist enrichment and song/album cards.
 * Every request is cached for 24 h and spends one token from the shared budget;
 * a cool-down rejects as a `rate` error so the deck can offer a retry instead
 * of reporting the artist or album as "not there".
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

/** A song lookup by album id: the album's own tracks fill the first hits. */
const ALBUM_SONGS_LIMIT = 5;
/** Short or common artist names put other acts first; one wider search finds the real one. */
const ARTIST_SONGS_LIMIT = 25;

const albumIdOf = (key: string): number | undefined => {
  const match = /^it:album:(\d+)$/.exec(key);
  return match ? Number(match[1]) : undefined;
};

const yearOf = (releaseDate?: string): number | undefined => {
  const year = releaseDate ? Number(releaseDate.slice(0, 4)) : Number.NaN;
  return Number.isFinite(year) ? year : undefined;
};

/** Apple appends the release kind to single/EP album names: "Bitch - Single". */
const RELEASE_SUFFIX = /\s+[-–]\s+(Single|EP)$/i;

const releaseOf = (name: string): { title: string; releaseType?: ReleaseType } => {
  const match = RELEASE_SUFFIX.exec(name);
  if (!match) return { title: name };
  const releaseType = match[1].toLowerCase() === 'ep' ? 'EP' : 'Single';
  return { title: name.slice(0, match.index), releaseType };
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
function lookupResults(path: string, options: BudgetOptions = {}): Promise<ItunesResult[] | null> {
  const url = `${ITUNES_API}${path}`;
  return cached(url, () => withItunesBudget<ItunesResult[] | null>(null, () => fetchResults(url), options));
}

/**
 * Card-building lookups must not turn a cool-down into an empty answer: the deck
 * would blame the seeds or claim the direction is exhausted. A 'budget' error is
 * the app's own allowance (no request failed), not the catalog being unreachable.
 */
const COOLING_DOWN = 'iTunes is cooling down';

/**
 * A dealt album card resolves its preview with a follow-up song lookup, and the
 * first two cards ask for one right after the deck deals. Album enrichment leaves
 * these two tokens unspent, otherwise a fresh Albums deck spends the whole budget
 * dealing and its first card can never find a sample. Song cards already carry
 * their preview, so their lookups reserve nothing.
 */
const SAMPLE_RESERVE = 2;

export async function enrichArtist(
  name: string,
  options: LookupOptions = {},
): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
  const results = await lookupResults(
    `/search?term=${encodeURIComponent(name)}&media=music&entity=musicArtist&limit=5`,
    { reserve: SAMPLE_RESERVE, wait: options.waitForBudget },
  );
  if (results === null) throw new CatalogError('budget', COOLING_DOWN);

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

export async function artistTopTracks(
  itunesArtistId: number,
  limit: number,
  options: LookupOptions = {},
): Promise<Card[]> {
  const results = await lookupResults(`/lookup?id=${itunesArtistId}&entity=song&limit=${limit}`, {
    wait: options.waitForBudget,
  });
  if (results === null) throw new CatalogError('budget', COOLING_DOWN);
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

export async function artistAlbums(
  itunesArtistId: number,
  limit: number,
  options: LookupOptions = {},
): Promise<Card[]> {
  const results = await lookupResults(
    `/lookup?id=${itunesArtistId}&entity=album&limit=${limit}`,
    { reserve: SAMPLE_RESERVE, wait: options.waitForBudget },
  );
  if (results === null) throw new CatalogError('budget', COOLING_DOWN);
  if (results.length === 0) {
    throw new CatalogError('notfound', `iTunes has no artist ${itunesArtistId}`);
  }

  return results
    .filter((result) => result.wrapperType === 'collection' && result.collectionId !== undefined)
    .slice(0, limit)
    .map((result): Card => {
      const release = releaseOf(result.collectionName ?? '');
      return {
        key: `it:album:${result.collectionId}`,
        kind: 'album',
        source: 'itunes',
        title: release.title,
        creator: result.artistName ?? '',
        creatorKey: creatorKey(result.artistName ?? ''),
        year: yearOf(result.releaseDate),
        image: artwork600(result.artworkUrl100),
        appleUrl: withoutTracking(result.collectionViewUrl),
        ...(release.releaseType ? { releaseType: release.releaseType } : {}),
        chips: chipsOf(result),
      };
    });
}

/**
 * First source that finds a preview wins. A failed source does not hide another
 * source's answer (including a genuine no-match); the failure is reported only
 * when no source answered at all, so the caller still sees a transient error as
 * retryable, not as "no sample".
 */
async function firstSample(attempts: (() => Promise<Sample | undefined>)[]): Promise<Sample | undefined> {
  let failure: unknown;
  for (const attempt of attempts) {
    try {
      const sample = await attempt();
      if (sample) return sample;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
  return undefined;
}

/**
 * Just-in-time sample for a card the catalog ships without one. Artist cards
 * try Deezer's top tracks first (the card carries its Deezer id and its
 * previews cost no iTunes budget), then iTunes; album and song cards try
 * iTunes first, then a Deezer track search for the same artist. A genuine
 * no-match on both resolves `undefined`; a failure (offline, HTTP error,
 * cooling budget) rejects so the caller can tell a miss from a transient
 * error and retry. With `waitForBudget` the iTunes lookup waits for the next
 * token (abandonable with `signal`). The sample names its song. Deezer URLs are
 * signed and expire in ~15 min, so nothing here caches or persists them.
 */
export async function samplePreview(card: Card, options: SampleOptions = {}): Promise<Sample | undefined> {
  if (card.kind === 'song') {
    if (card.previewUrl) return { previewUrl: card.previewUrl, title: card.title };
    return trackSearchPreview(card.creator, card.title);
  }

  const budget: BudgetOptions = {
    wait: options.waitForBudget ?? false,
    priority: options.priority ?? false,
    signal: options.signal,
  };

  const sampleOf = (result?: ItunesResult): Sample | undefined =>
    result?.previewUrl ? { previewUrl: result.previewUrl, title: result.trackName } : undefined;

  /** Rows may be filled by other artists: the exact name beats a partial hit. */
  const bestByArtist = (results: ItunesResult[], artist: string): ItunesResult | undefined => {
    let best: ItunesResult | undefined;
    let bestScore = 0;
    for (const result of results) {
      if (!result.previewUrl) continue;
      const score = nameScore(artist, result.artistName ?? '');
      if (score > bestScore) {
        best = result;
        bestScore = score;
      }
    }
    return best;
  };

  const fromItunes = async (): Promise<Sample | undefined> => {
    if (card.kind === 'album') {
      const id = albumIdOf(card.key);
      if (id === undefined) return undefined;
      const songs = await lookupResults(`/lookup?id=${id}&entity=song&limit=${ALBUM_SONGS_LIMIT}`, budget);
      if (songs === null) throw new CatalogError('budget', COOLING_DOWN);
      return sampleOf(songs.find((song) => song.previewUrl));
    }
    const results = await lookupResults(
      `/search?term=${encodeURIComponent(card.creator)}&media=music&entity=song&limit=${ARTIST_SONGS_LIMIT}`,
      budget,
    );
    if (results === null) throw new CatalogError('budget', COOLING_DOWN);
    return sampleOf(bestByArtist(results, card.creator));
  };

  const deezerArtistId = card.kind === 'artist' ? deezerArtistIdOf(card.key) : undefined;
  if (deezerArtistId !== undefined) {
    // Deezer's top list is best effort: its failure must not hide iTunes's
    // answer, or a Deezer hiccup alone leaves the card waiting for a sample.
    try {
      const sample = await artistTopPreview(deezerArtistId);
      if (sample) return sample;
    } catch {
      // Fall through: iTunes is the trusted source, and its failure stays retryable.
    }
    return fromItunes();
  }
  return firstSample([fromItunes, () => trackSearchPreview(card.creator, card.title)]);
}
