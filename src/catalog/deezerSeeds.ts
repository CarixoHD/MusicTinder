import type { SeedCandidate } from '../types';
import { jsonp } from './deezerJsonp';

/**
 * Deezer artist search standing in for Apple when iTunes refuses a Setup
 * search (403/429). Same JSONP transport as the rest of Deezer (ADR-002).
 */

const DEEZER_API = 'https://api.deezer.com';
const SEARCH_LIMIT = 8;
/** An exact-name profile with under 1% of the top hit's fans is an empty duplicate. */
const DUPLICATE_FAN_RATIO = 0.01;

interface DeezerList {
  data?: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Deezer's search lists near-empty duplicate profiles for a popular artist
 * (a 6-fan "Carpenter Brut" next to the 84k one). Fans decide the order, and a
 * same-name profile with under 1% of the top hit's fans is dropped, so the main
 * profile stays the obvious pick.
 */
function rankByFans(candidates: SeedCandidate[]): SeedCandidate[] {
  const ranked = [...candidates].sort((a, b) => (b.fans ?? 0) - (a.fans ?? 0));
  // The best profile per exact name is the yardstick for that name's duplicates.
  const bestByName = new Map<string, number>();
  for (const candidate of ranked) {
    const key = nameKey(candidate.name);
    bestByName.set(key, Math.max(bestByName.get(key) ?? 0, candidate.fans ?? 0));
  }
  return ranked.filter((candidate) => {
    const best = bestByName.get(nameKey(candidate.name)) ?? 0;
    return best <= 0 || (candidate.fans ?? 0) >= best * DUPLICATE_FAN_RATIO;
  });
}

export async function searchDeezerArtists(term: string): Promise<SeedCandidate[]> {
  const payload = await jsonp<DeezerList>(
    `${DEEZER_API}/search/artist?q=${encodeURIComponent(term.trim())}&limit=${SEARCH_LIMIT}`,
  );

  // Network payload boundary: Deezer rows are untrusted; unusable ones are dropped.
  const candidates = (payload.data ?? []).filter(isRecord).flatMap((row): SeedCandidate[] => {
    const { id, name, picture_medium, nb_fan } = row;
    if (typeof id !== 'number' || typeof name !== 'string') return [];
    return [
      {
        deezerArtistId: id,
        kind: 'artist',
        name,
        creator: name,
        image: typeof picture_medium === 'string' ? picture_medium : undefined,
        chips: ['other'],
        fans: typeof nb_fan === 'number' ? nb_fan : undefined,
      },
    ];
  });

  return rankByFans(candidates);
}
