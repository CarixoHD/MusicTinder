import type { Catalog, SeedSearchOptions } from '../types';
import { relatedArtists, resolveDeezerArtist } from './deezer';
import { searchDeezerArtists } from './deezerSeeds';
import { searchSeeds } from './itunes';
import { artistAlbums, artistTopTracks, enrichArtist, samplePreview } from './itunesLookup';

/**
 * Setup's artist seed search is Deezer-first (ADR-005): typing never spends the
 * iTunes budget the deck needs. Only Setup passes `wait`; generation's genre
 * anchors deliberately skip Deezer, because /search/artist matches artist names
 * only — 'Pop' would anchor on obscure acts named after the genre.
 */
async function searchSeedsDeezerFirst(
  term: string,
  type: 'artist' | 'album',
  options: SeedSearchOptions = {},
) {
  if (type !== 'artist' || options.wait !== true) return searchSeeds(term, type, options);
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
