import type { Card, DeezerArtistRef, Sample } from '../types';
import { jsonp } from './deezerJsonp';

/** Deezer public API over the quarantined JSONP transport (ADR-002). */

const DEEZER_API = 'https://api.deezer.com';
const SEARCH_LIMIT = 5;
const ARTIST_TOP_LIMIT = 10;
const TRACK_SEARCH_LIMIT = 10;

interface DeezerArtist {
  id: number;
  name: string;
  picture_big?: string;
  nb_fan?: number;
  nb_album?: number;
}

interface DeezerTrack {
  id?: number;
  title?: string;
  preview?: string;
  artist?: { name?: string };
}

interface DeezerList<T> {
  data?: T[];
}

/** Normalised lower-case name so Deezer and iTunes agree (see FakeCatalog). */
const creatorKey = (name: string) => name.trim().toLowerCase();

const matchScore = (query: string, name: string): number => {
  const q = creatorKey(query);
  const n = creatorKey(name);
  if (!q || !n) return 0;
  if (q === n) return 2;
  return n.includes(q) || q.includes(n) ? 1 : 0;
};

/** Exact name first, then most fans; the sort is stable, so search order breaks remaining ties. */
const byMatchThenFans = (query: string) => (a: DeezerArtist, b: DeezerArtist) =>
  matchScore(query, b.name) - matchScore(query, a.name) || (b.nb_fan ?? 0) - (a.nb_fan ?? 0);

export async function resolveDeezerArtist(name: string): Promise<DeezerArtistRef | null> {
  const payload = await jsonp<DeezerList<DeezerArtist>>(
    `${DEEZER_API}/search/artist?q=${encodeURIComponent(name)}&limit=${SEARCH_LIMIT}`,
  );

  const ranked = (payload.data ?? []).filter((artist) => matchScore(name, artist.name) > 0).sort(byMatchThenFans(name));
  const best = ranked[0];
  if (!best) return null;

  // Deezer lists near-empty duplicate profiles ahead of the real artist; keep the
  // same-name ones ranked by fans so generation can fall back when one deals nothing.
  const alternatives = ranked
    .slice(1)
    .filter((artist) => creatorKey(artist.name) === creatorKey(best.name))
    .map((artist) => ({ id: artist.id, name: artist.name }));

  return alternatives.length > 0
    ? { id: best.id, name: best.name, alternatives }
    : { id: best.id, name: best.name };
}

const sampleOf = (track: DeezerTrack): Sample | undefined =>
  track.preview ? { previewUrl: track.preview, title: track.title } : undefined;

/** Artist cards carry their Deezer id in the key (`dz:artist:<id>`). */
export function deezerArtistIdOf(key: string): number | undefined {
  const match = /^dz:artist:(\d+)$/.exec(key);
  return match ? Number(match[1]) : undefined;
}

/**
 * Any track by the artist with a preview; the top list arrives most popular
 * first. Deezer signs these URLs for ~15 min, so callers keep them in memory.
 */
export async function artistTopPreview(deezerArtistId: number): Promise<Sample | undefined> {
  const payload = await jsonp<DeezerList<DeezerTrack>>(
    `${DEEZER_API}/artist/${deezerArtistId}/top?limit=${ARTIST_TOP_LIMIT}`,
  );
  for (const track of payload.data ?? []) {
    const sample = sampleOf(track);
    if (sample) return sample;
  }
  return undefined;
}

/** Search rows can carry a cover or another act: only this artist's tracks count. */
export async function trackSearchPreview(artist: string, title: string): Promise<Sample | undefined> {
  const query = `${artist} ${title}`.trim();
  const payload = await jsonp<DeezerList<DeezerTrack>>(
    `${DEEZER_API}/search/track?q=${encodeURIComponent(query)}&limit=${TRACK_SEARCH_LIMIT}`,
  );
  const own = (payload.data ?? []).filter(
    (track) => track.preview && creatorKey(track.artist?.name ?? '') === creatorKey(artist),
  );
  const exact = own.find((track) => creatorKey(track.title ?? '') === creatorKey(title));
  return sampleOf(exact ?? own[0] ?? {});
}

export async function relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
  const payload = await jsonp<DeezerList<DeezerArtist>>(
    `${DEEZER_API}/artist/${deezerArtistId}/related?limit=${limit}`,
  );

  return (payload.data ?? []).slice(0, limit).map((artist) => ({
    key: `dz:artist:${artist.id}`,
    kind: 'artist',
    source: 'deezer',
    title: artist.name,
    creator: artist.name,
    creatorKey: creatorKey(artist.name),
    image: artist.picture_big,
    fans: artist.nb_fan,
    albumCount: artist.nb_album,
    // Deezer preview URLs are signed and expire in ~15 min: never store one on a card.
    chips: [],
  }));
}
