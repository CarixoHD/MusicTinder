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

    await expect(catalog.searchSeeds('anything', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'unknown',
    });
  });
});
