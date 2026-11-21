import { describe, expect, it } from 'vitest';
import type { Catalog } from '../types';
import { FakeCatalog } from './fakeCatalog';

const ANCHOR_IDS = [4101, 4102, 4103];

describe('FakeCatalog', () => {
  it('implements the Catalog interface deterministically', async () => {
    const catalog: Catalog = new FakeCatalog();
    const again = new FakeCatalog();

    const first = await Promise.all(ANCHOR_IDS.map((id) => catalog.relatedArtists(id, 100)));
    const second = await Promise.all(ANCHOR_IDS.map((id) => again.relatedArtists(id, 100)));
    expect(first).toEqual(second);
  });

  it('offers at least 20 unique related candidates across several chips', async () => {
    const catalog = new FakeCatalog();
    const all = (await Promise.all(ANCHOR_IDS.map((id) => catalog.relatedArtists(id, 100)))).flat();
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(new Set(all.map((card) => card.key)).size).toBe(all.length);
    expect(new Set(all.flatMap((card) => card.chips)).size).toBeGreaterThanOrEqual(8);
  });

  it('includes some cards with no previewUrl', async () => {
    const catalog = new FakeCatalog();
    const tracks = await catalog.artistTopTracks(9101, 10);
    expect(tracks.some((card) => card.previewUrl === undefined)).toBe(true);
  });

  it('resolves and enriches the anchor artists', async () => {
    const catalog = new FakeCatalog();
    expect(await catalog.resolveDeezerArtist('ada vale')).toEqual({ id: 4101, name: 'Ada Vale' });
    expect(await catalog.enrichArtist('North Static')).toEqual({
      itunesArtistId: 9102,
      chips: ['indie', 'rock'],
    });
    expect(await catalog.enrichArtist('Nobody')).toBeNull();
  });
});
