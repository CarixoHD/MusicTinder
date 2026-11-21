import { describe, expect, it } from 'vitest';
import { FakeCatalog } from '../testkit/fakeCatalog';
import { CatalogError, type Card, type Catalog, type Chip, type Seed } from '../types';
import { generateCandidates } from './generate';

const ARTIST_SEEDS: Seed[] = [
  {
    id: 'seed-ada',
    kind: 'artist',
    name: 'Ada Vale',
    creatorKey: 'ada vale',
    itunesArtistId: 9101,
    deezerArtistId: 4101,
    chips: ['electronic', 'ambient'],
  },
  {
    id: 'seed-north',
    kind: 'artist',
    name: 'North Static',
    creatorKey: 'north static',
    itunesArtistId: 9102,
    deezerArtistId: 4102,
    chips: ['indie', 'rock'],
  },
];

const SEED_ARTIST_KEYS = new Set(ARTIST_SEEDS.map((seed) => seed.creatorKey));

/**
 * FakeCatalog enriches and looks up only its three anchor artists, but the
 * recommender consumes related artists. This fixture gives each related artist
 * a stable iTunes id and synthetic albums/tracks, so album/song generation can
 * be exercised without leaving the Catalog interface.
 */
class DeeperCatalog extends FakeCatalog {
  private readonly related = new Map<string, { card: Card; itunesArtistId: number }>();

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    const cards = await super.relatedArtists(deezerArtistId, limit);
    for (const card of cards) {
      if (!this.related.has(card.creatorKey)) {
        this.related.set(card.creatorKey, { card, itunesArtistId: 7000 + this.related.size });
      }
    }
    return cards;
  }

  override async enrichArtist(name: string) {
    const anchored = await super.enrichArtist(name);
    if (anchored) return anchored;
    const hit = this.related.get(name.trim().toLowerCase());
    return hit ? { itunesArtistId: hit.itunesArtistId, chips: hit.card.chips } : null;
  }

  protected hit(itunesArtistId: number) {
    return [...this.related.values()].find((entry) => entry.itunesArtistId === itunesArtistId);
  }

  override async artistAlbums(itunesArtistId: number, limit: number): Promise<Card[]> {
    const anchored = await super.artistAlbums(itunesArtistId, limit);
    if (anchored.length > 0) return anchored;
    const hit = this.hit(itunesArtistId);
    if (!hit) return [];
    return [1, 2].slice(0, limit).map((n) => this.release(hit.card, `it:album:${itunesArtistId}${n}`, 'album', n));
  }

  override async artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
    const anchored = await super.artistTopTracks(itunesArtistId, limit);
    if (anchored.length > 0) return anchored;
    const hit = this.hit(itunesArtistId);
    if (!hit) return [];
    return [1, 2].slice(0, limit).map((n) => this.release(hit.card, `it:track:${itunesArtistId}${n}`, 'song', n));
  }

  private release(artist: Card, key: string, kind: Card['kind'], n: number): Card {
    return {
      key,
      kind,
      source: 'itunes',
      title: `${artist.title} ${kind} ${n}`,
      creator: artist.creator,
      creatorKey: artist.creatorKey,
      chips: artist.chips,
      image: `https://cdn.example.test/${key}.jpg`,
    };
  }
}

/** An artist reachable from both artist seeds. */
const SHARED: Card = {
  key: 'dz:artist:5999',
  kind: 'artist',
  source: 'deezer',
  title: 'Shared Artist',
  creator: 'Shared Artist',
  creatorKey: 'shared artist',
  image: 'https://cdn.example.test/artists/5999.jpg',
  chips: ['pop'],
};

class OverlapCatalog extends FakeCatalog {
  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    const cards = await super.relatedArtists(deezerArtistId, limit);
    return deezerArtistId === 4101 || deezerArtistId === 4102 ? [...cards, SHARED] : cards;
  }
}

class GenreCatalog extends FakeCatalog {
  override async searchSeeds(term: string, type: 'artist' | 'album') {
    if (type === 'artist' && term === 'Electronic') {
      return [
        {
          itunesId: 9101,
          kind: 'artist' as const,
          name: 'Ada Vale',
          creator: 'Ada Vale',
          chips: ['electronic', 'ambient'] as Chip[],
        },
      ];
    }
    return super.searchSeeds(term, type);
  }
}

class FailingAnchorCatalog extends FakeCatalog {
  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (deezerArtistId === 4102) throw new CatalogError('rate', 'rate limited');
    return super.relatedArtists(deezerArtistId, limit);
  }
}

class FailingEnrichmentCatalog extends DeeperCatalog {
  override async enrichArtist(name: string) {
    if (name.trim().toLowerCase() === 'glass harbour') throw new CatalogError('network', 'offline');
    return super.enrichArtist(name);
  }
}

/** Related artists resolve, but every release lookup fails: a partial outage. */
class FailingReleasesCatalog extends DeeperCatalog {
  override async artistAlbums(): Promise<Card[]> {
    throw new CatalogError('network', 'offline');
  }
}

/** The catalog answers "nothing there" for every anchor. */
class NotFoundCatalog extends FakeCatalog {
  override async relatedArtists(): Promise<Card[]> {
    throw new CatalogError('notfound', 'no data');
  }
}

const failingCatalog = (): Catalog => {
  const fail = async (): Promise<never> => {
    throw new CatalogError('network', 'offline');
  };
  return {
    searchSeeds: fail,
    resolveDeezerArtist: fail,
    relatedArtists: fail,
    enrichArtist: fail,
    artistTopTracks: fail,
    artistAlbums: fail,
    samplePreview: fail,
  };
};

describe('generateCandidates', () => {
  it('returns only artist cards, none seen and none a seed artist', async () => {
    const cards = await generateCandidates(new FakeCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.kind === 'artist')).toBe(true);
    expect(cards.every((card) => !SEED_ARTIST_KEYS.has(card.creatorKey))).toBe(true);
    expect(cards.every((card) => card.related && card.related.length > 0)).toBe(true);
  });

  it('never returns a seen key', async () => {
    const first = await generateCandidates(new FakeCatalog(), ARTIST_SEEDS, 'artist', new Set());
    const seen = new Set([first[0].key]);

    const again = await generateCandidates(new FakeCatalog(), ARTIST_SEEDS, 'artist', seen);

    expect(again.some((card) => card.key === first[0].key)).toBe(false);
    expect(again.length).toBe(first.length - 1);
  });

  it('returns a candidate reached from two anchors once, with both anchors in related', async () => {
    const cards = await generateCandidates(new OverlapCatalog(), ARTIST_SEEDS, 'artist', new Set());
    const shared = cards.filter((card) => card.creatorKey === 'shared artist');

    expect(shared).toHaveLength(1);
    expect(shared[0].related).toEqual(['ada vale', 'north static']);
  });

  it.each(['album', 'song'] as const)(
    'returns only %s cards from enriched related artists, carrying chips and anchors',
    async (cardType) => {
      const cards = await generateCandidates(new DeeperCatalog(), ARTIST_SEEDS, cardType, new Set());

      expect(cards.length).toBeGreaterThan(0);
      expect(cards.every((card) => card.kind === cardType)).toBe(true);
      expect(cards.every((card) => !SEED_ARTIST_KEYS.has(card.creatorKey))).toBe(true);
      expect(cards.every((card) => (card.chips.length ?? 0) > 0)).toBe(true);
      expect(cards.every((card) => card.related && card.related.length > 0)).toBe(true);
    },
  );

  it.each(['album', 'song'] as const)('never returns a seen %s', async (cardType) => {
    const first = await generateCandidates(new DeeperCatalog(), ARTIST_SEEDS, cardType, new Set());
    const seen = new Set([first[0].key]);

    const again = await generateCandidates(new DeeperCatalog(), ARTIST_SEEDS, cardType, seen);

    expect(again.some((card) => card.key === first[0].key)).toBe(false);
    expect(again.length).toBe(first.length - 1);
  });

  it('uses the artist behind an album seed as the anchor', async () => {
    const seeds: Seed[] = [
      {
        id: 'album',
        kind: 'album',
        name: 'North Static No. 1',
        creatorKey: 'north static',
        chips: ['indie', 'rock'],
      },
    ];

    const cards = await generateCandidates(new FakeCatalog(), seeds, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.related?.includes('north static'))).toBe(true);
    expect(cards.some((card) => card.creatorKey === 'north static')).toBe(false);
  });

  it('turns a genre-only seed into candidates through searchSeeds anchors', async () => {
    const seeds: Seed[] = [{ id: 'g', kind: 'genre', name: 'Electronic', chips: ['electronic'] }];

    const cards = await generateCandidates(new GenreCatalog(), seeds, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.kind === 'artist')).toBe(true);
  });

  it('skips a failing anchor and still returns the other anchors’ candidates', async () => {
    const cards = await generateCandidates(new FailingAnchorCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => card.related?.includes('north static'))).toBe(false);
    expect(cards.every((card) => card.related?.includes('ada vale'))).toBe(true);
  });

  it('skips a failing enrichment instead of failing the refill', async () => {
    const cards = await generateCandidates(new FailingEnrichmentCatalog(), ARTIST_SEEDS, 'album', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some((card) => card.creatorKey === 'glass harbour')).toBe(false);
  });

  it('rejects with the CatalogError when every call fails', async () => {
    await expect(generateCandidates(failingCatalog(), ARTIST_SEEDS, 'artist', new Set())).rejects.toBeInstanceOf(
      CatalogError,
    );
  });

  it('rejects when catalog failures leave nothing to deal, instead of reporting a dry deck', async () => {
    await expect(
      generateCandidates(new FailingReleasesCatalog(), ARTIST_SEEDS, 'album', new Set()),
    ).rejects.toBeInstanceOf(CatalogError);
  });

  it('treats a catalog answer of "nothing there" as an empty deck, not an outage', async () => {
    const cards = await generateCandidates(new NotFoundCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards).toEqual([]);
  });
});
