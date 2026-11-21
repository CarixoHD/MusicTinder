import { describe, expect, it } from 'vitest';
import type { Catalog } from '../types';
import { createCatalog } from './index';

describe('createCatalog', () => {
  it('composes all six methods', () => {
    const catalog: Catalog = createCatalog();
    expect(Object.keys(catalog).sort()).toEqual([
      'artistAlbums',
      'artistTopTracks',
      'enrichArtist',
      'relatedArtists',
      'resolveDeezerArtist',
      'searchSeeds',
    ]);
  });

  it('stub adapters reject with a typed unknown CatalogError', async () => {
    const catalog = createCatalog();
    const failures = [
      () => catalog.resolveDeezerArtist('anything'),
      () => catalog.relatedArtists(1, 5),
      () => catalog.enrichArtist('anything'),
      () => catalog.artistTopTracks(1, 5),
      () => catalog.artistAlbums(1, 5),
    ];

    for (const failure of failures) {
      await expect(failure()).rejects.toMatchObject({ name: 'CatalogError', kind: 'unknown' });
    }
  });
});
