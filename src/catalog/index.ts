import type { Catalog, SeedSearchOptions } from '../types';
import { relatedArtists, resolveDeezerArtist } from './deezer';
import { searchDeezerArtists } from './deezerSeeds';
import { searchSeeds } from './itunes';
import { artistAlbums, artistTopTracks, enrichArtist, samplePreview } from './itunesLookup';

/**
 * Artist seed search is Deezer-first (ADR-005): typing never spends the iTunes
 * budget the deck needs. Apple answers only when Deezer errors or times out;
 * album search stays on iTunes.
 */
async function searchSeedsDeezerFirst(
  term: string,
  type: 'artist' | 'album',
  options: SeedSearchOptions = {},
) {
  if (type !== 'artist') return searchSeeds(term, type, options);
  try {
    return await searchDeezerArtists(term);
  } catch (error) {
    // An abandoned term asks nobody, not even the fallback.
    if (options.signal?.aborted === true) throw error;
    return searchSeeds(term, type, options);
  }
}

/** The one catalog seam. Slices replace adapter bodies, never this composition. */
export function createCatalog(): Catalog {
  return {
    searchSeeds: searchSeedsDeezerFirst,
    resolveDeezerArtist,
    relatedArtists,
    enrichArtist,
    artistTopTracks,
    artistAlbums,
    samplePreview,
  };
}
