import type { Card } from '../types';
import { jsonp } from './deezerJsonp';

/** Deezer public API over the quarantined JSONP transport (ADR-002). */

const DEEZER_API = 'https://api.deezer.com';
const SEARCH_LIMIT = 5;

interface DeezerArtist {
  id: number;
  name: string;
  picture_big?: string;
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

export async function resolveDeezerArtist(name: string): Promise<{ id: number; name: string } | null> {
  const payload = await jsonp<DeezerList<DeezerArtist>>(
    `${DEEZER_API}/search/artist?q=${encodeURIComponent(name)}&limit=${SEARCH_LIMIT}`,
  );

  let best: DeezerArtist | null = null;
  let bestScore = 0;
  for (const artist of payload.data ?? []) {
    const score = matchScore(name, artist.name);
    if (score > bestScore) {
      best = artist;
      bestScore = score;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
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
    // Deezer preview URLs are signed and expire in ~15 min: never store one on a card.
    chips: [],
  }));
}
