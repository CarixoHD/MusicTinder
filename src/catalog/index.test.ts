import { describe, expect, it } from 'vitest';
import type { Catalog } from '../types';
import { createCatalog } from './index';

describe('createCatalog', () => {
  it('composes all seven methods', () => {
    const catalog: Catalog = createCatalog();
    expect(Object.keys(catalog).sort()).toEqual([
      'artistAlbums',
      'artistTopTracks',
      'enrichArtist',
      'relatedArtists',
      'resolveDeezerArtist',
      'samplePreview',
      'searchSeeds',
    ]);
  });

  it('wires the real adapters (no stubs remain)', async () => {
    const catalog = createCatalog();
    const { searchSeeds } = await import('./itunes');
    const { enrichArtist, artistTopTracks, artistAlbums, samplePreview } = await import('./itunesLookup');
    const { relatedArtists, resolveDeezerArtist } = await import('./deezer');

    expect(catalog.searchSeeds).toBe(searchSeeds);
    expect(catalog.enrichArtist).toBe(enrichArtist);
    expect(catalog.artistTopTracks).toBe(artistTopTracks);
    expect(catalog.artistAlbums).toBe(artistAlbums);
    expect(catalog.samplePreview).toBe(samplePreview);
    expect(catalog.relatedArtists).toBe(relatedArtists);
    expect(catalog.resolveDeezerArtist).toBe(resolveDeezerArtist);
  });
});
