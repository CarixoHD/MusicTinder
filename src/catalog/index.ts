import type { Catalog } from '../types';
import { relatedArtists, resolveDeezerArtist } from './deezer';
import { searchSeeds } from './itunes';
import { artistAlbums, artistTopTracks, enrichArtist, samplePreview } from './itunesLookup';

/** The one catalog seam. Slices replace adapter bodies, never this composition. */
export function createCatalog(): Catalog {
  return {
    searchSeeds,
    resolveDeezerArtist,
    relatedArtists,
    enrichArtist,
    artistTopTracks,
    artistAlbums,
    samplePreview,
  };
}
