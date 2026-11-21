import type { Card, DeezerArtistRef } from '../types';
import { jsonp } from './deezerJsonp';

/** Deezer public API over the quarantined JSONP transport (ADR-002). */

const DEEZER_API = 'https://api.deezer.com';
const SEARCH_LIMIT = 5;

interface DeezerArtist {
  id: number;
  name: string;
  picture_big?: string;
  nb_fan?: number;
  nb_album?: number;
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
