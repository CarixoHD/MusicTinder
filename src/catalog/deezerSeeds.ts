import type { SeedCandidate } from '../types';
import { jsonp } from './deezerJsonp';

/**
 * Deezer artist search standing in for Apple when iTunes refuses a Setup
 * search (403/429). Same JSONP transport as the rest of Deezer (ADR-002).
 */

const DEEZER_API = 'https://api.deezer.com';
const SEARCH_LIMIT = 8;

interface DeezerList {
  data?: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export async function searchDeezerArtists(term: string): Promise<SeedCandidate[]> {
  const payload = await jsonp<DeezerList>(
    `${DEEZER_API}/search/artist?q=${encodeURIComponent(term.trim())}&limit=${SEARCH_LIMIT}`,
  );

  // Network payload boundary: Deezer rows are untrusted; unusable ones are dropped.
  return (payload.data ?? []).filter(isRecord).flatMap((row): SeedCandidate[] => {
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
}
