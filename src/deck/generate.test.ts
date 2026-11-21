import { describe, expect, it } from 'vitest';
import { CHIPS } from '../chips';
import { FakeCatalog } from '../testkit/fakeCatalog';
import {
  CatalogError,
  type Card,
  type Catalog,
  type Chip,
  type LookupOptions,
  type Seed,
  type SeedCandidate,
} from '../types';
import {
  generateCandidates,
  LIKED_ANCHOR_LIMIT,
  WAIT_ARTIST_LIMIT,
  WILDCARD_ENRICH_LIMIT,
} from './generate';

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

/** The same anchors, but resolution has to happen at generation time. */
const UNRESOLVED_SEEDS: Seed[] = ARTIST_SEEDS.map((seed) => ({ ...seed, deezerArtistId: undefined }));

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

/** Records which lookups were allowed to wait on the iTunes budget. */
class WaitingCatalog extends DeeperCatalog {
  readonly enrichWaits: boolean[] = [];
  readonly releaseWaits: boolean[] = [];

  override async enrichArtist(name: string, options?: LookupOptions) {
    this.enrichWaits.push(options?.waitForBudget === true);
    return super.enrichArtist(name);
  }

  override async artistTopTracks(itunesArtistId: number, limit: number, options?: LookupOptions) {
    this.releaseWaits.push(options?.waitForBudget === true);
    return super.artistTopTracks(itunesArtistId, limit);
  }

  override async artistAlbums(itunesArtistId: number, limit: number, options?: LookupOptions) {
    this.releaseWaits.push(options?.waitForBudget === true);
    return super.artistAlbums(itunesArtistId, limit);
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

  override async enrichArtist(name: string) {
    if (name.trim().toLowerCase() === SHARED.creatorKey) {
      return { itunesArtistId: 5999, chips: SHARED.chips };
    }
    return super.enrichArtist(name);
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

/** One artist is unreachable, the rest cool down: the outage is the real cause. */
class MixedFailureCatalog extends DeeperCatalog {
  override async enrichArtist(name: string): Promise<never> {
    if (name.trim().toLowerCase() === 'glass harbour') throw new CatalogError('network', 'offline');
    throw new CatalogError('budget', 'iTunes is cooling down');
  }
}

/** Every enrichment cools down: a transient budget failure, not "nothing there". */
class CoolingCatalog extends DeeperCatalog {
  override async enrichArtist(): Promise<never> {
    throw new CatalogError('budget', 'iTunes is cooling down');
  }
}

/** Related artists resolve, but every release lookup fails: a partial outage. */
class FailingReleasesCatalog extends DeeperCatalog {
  override async artistAlbums(): Promise<Card[]> {
    throw new CatalogError('network', 'offline');
  }
}

/**
 * The search lists a near-empty duplicate profile (same name, no related
 * artists) ahead of the real one, as Deezer does for Carpenter Brut/Kavinsky.
 */
class DuplicateProfileCatalog extends FakeCatalog {
  override async resolveDeezerArtist(name: string) {
    const real = await super.resolveDeezerArtist(name);
    return real && { id: real.id + 50_000, name: real.name, alternatives: [real] };
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (deezerArtistId > 50_000) return [];
    return super.relatedArtists(deezerArtistId, limit);
  }
}

/** A seed saved in an older session carries the empty duplicate's id. */
const DEAD_PROFILE_ID = 459_101;

/** Ada Vale's name resolves to the real profile (the dead duplicate listed as an alternative). */
class DeadStoredIdCatalog extends FakeCatalog {
  readonly resolved: string[] = [];
  readonly relatedCalls: number[] = [];

  override async resolveDeezerArtist(name: string) {
    this.resolved.push(name.trim().toLowerCase());
    const real = await super.resolveDeezerArtist(name);
    return real
      ? { id: real.id, name: real.name, alternatives: [{ id: DEAD_PROFILE_ID, name: real.name }] }
      : null;
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    this.relatedCalls.push(deezerArtistId);
    return deezerArtistId === DEAD_PROFILE_ID ? [] : super.relatedArtists(deezerArtistId, limit);
  }
}

const DEAD_SEEDS: Seed[] = [{ ...ARTIST_SEEDS[0], deezerArtistId: DEAD_PROFILE_ID }];

/** Deezer answers the dead profile with an unrecognised error rather than an empty list. */
class UnknownErrorStoredIdCatalog extends DeadStoredIdCatalog {
  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (deezerArtistId === DEAD_PROFILE_ID) throw new CatalogError('unknown', 'deezer hiccup');
    return super.relatedArtists(deezerArtistId, limit);
  }
}

/** The catalog is down: the stored id fails with an outage, not an empty profile. */
class OutageStoredIdCatalog extends DeadStoredIdCatalog {
  override async relatedArtists(): Promise<Card[]> {
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

/** Related artists ship without genres (as Deezer does); only iTunes has them. */
class UnenrichedCatalog extends FakeCatalog {
  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    const cards = await super.relatedArtists(deezerArtistId, limit);
    return cards.map((card) => ({ ...card, chips: [] }));
  }
}

/** One related artist that iTunes cannot identify. */
class UnknownArtistCatalog extends UnenrichedCatalog {
  override async enrichArtist(name: string) {
    return name.trim().toLowerCase() === 'glass harbour' ? null : super.enrichArtist(name);
  }
}

/**
 * The iTunes budget is cooling down: only a lookup allowed to wait gets a
 * token. Glass Harbour is the first related artist and iTunes has no match for
 * it, so the first wait yields nothing at all.
 */
class CoolingFirstUnknownCatalog extends DeeperCatalog {
  readonly enrichWaits: boolean[] = [];
  readonly releaseWaits: boolean[] = [];

  override async enrichArtist(name: string, options?: LookupOptions) {
    const wait = options?.waitForBudget === true;
    this.enrichWaits.push(wait);
    if (!wait) throw new CatalogError('budget', 'iTunes is cooling down');
    return name.trim().toLowerCase() === 'glass harbour' ? null : super.enrichArtist(name);
  }

  override async artistTopTracks(itunesArtistId: number, limit: number, options?: LookupOptions) {
    const wait = options?.waitForBudget === true;
    this.releaseWaits.push(wait);
    if (!wait) throw new CatalogError('budget', 'iTunes is cooling down');
    return super.artistTopTracks(itunesArtistId, limit);
  }

  override async artistAlbums(itunesArtistId: number, limit: number, options?: LookupOptions) {
    const wait = options?.waitForBudget === true;
    this.releaseWaits.push(wait);
    if (!wait) throw new CatalogError('budget', 'iTunes is cooling down');
    return super.artistAlbums(itunesArtistId, limit);
  }
}

const PREFIX_ROSTER: Card[] = ['Miss One', 'Blank Two', 'Tag Three', 'Late Four'].map((name, index) => ({
  key: `dz:artist:${6100 + index}`,
  kind: 'artist',
  source: 'deezer',
  title: name,
  creator: name,
  creatorKey: name.toLowerCase(),
  chips: [],
}));

/** The first artists are untaggable: one has no iTunes match, one no genre. */
class CoolingUntaggedPrefixCatalog extends FakeCatalog {
  readonly enrichWaits: boolean[] = [];

  override async relatedArtists(deezerArtistId: number): Promise<Card[]> {
    return deezerArtistId === 4101 ? PREFIX_ROSTER : [];
  }

  override async enrichArtist(
    name: string,
    options?: LookupOptions,
  ): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    const wait = options?.waitForBudget === true;
    this.enrichWaits.push(wait);
    if (!wait) throw new CatalogError('budget', 'iTunes is cooling down');
    const key = name.trim().toLowerCase();
    if (key === 'miss one') return null;
    if (key === 'blank two') return { itunesArtistId: 6101, chips: [] };
    return { itunesArtistId: 6102, chips: ['rock'] };
  }
}

/** Every related artist is unknown to iTunes while the budget cools down. */
class CoolingUntaggableCatalog extends DeeperCatalog {
  readonly enrichWaits: boolean[] = [];

  override async enrichArtist(_name: string, options?: LookupOptions) {
    const wait = options?.waitForBudget === true;
    this.enrichWaits.push(wait);
    if (!wait) throw new CatalogError('budget', 'iTunes is cooling down');
    return null;
  }
}

const TOP_CHIPS: Chip[] = ['electronic', 'ambient', 'indie'];

/** A small related-artist branch on chips the listener already likes. */
const ON_TASTE_BRANCH: Card[] = [1, 2].map((n) => ({
  key: `dz:artist:${7100 + n}`,
  kind: 'artist',
  source: 'deezer',
  title: `On Taste ${n}`,
  creator: `On Taste ${n}`,
  creatorKey: `on taste ${n}`,
  image: `https://cdn.example.test/artists/${7100 + n}.jpg`,
  chips: ['electronic'],
}));

/**
 * No related artist falls outside the top chips, so a wildcard has to come
 * from the genre search. Mirrors the live API: an album-entity search returns
 * artwork and each hit's own genre, while an artist-entity search only finds
 * acts *named* after the term and carries no artwork at all. Counts the
 * searches and the enrichments each wildcard costs.
 */
class WildcardCatalog implements Catalog {
  readonly searches: { term: string; type: 'artist' | 'album' }[] = [];
  readonly wildcardEnrichments: string[] = [];
  private readonly artists = new Map<number, { name: string; chips: Chip[] }>();

  constructor(
    private readonly branch: Card[] = ON_TASTE_BRANCH,
    private readonly artwork = true,
    /** The first hits are albums only titled after the genre: the chip filter must reject them. */
    private readonly mislabelled = false,
  ) {}

  async searchSeeds(term: string, type: 'artist' | 'album'): Promise<SeedCandidate[]> {
    this.searches.push({ term, type });
    const chip = CHIPS.find((candidate) => candidate.label === term);
    if (type === 'artist' || chip === undefined) {
      return [{ itunesId: 8400, kind: 'artist', name: term, creator: term, chips: [chip?.id ?? 'other'] }];
    }
    return Array.from({ length: 5 }, (_, index) => {
      const name = `Outside Act ${index + 1}`;
      const chips: Chip[] = this.mislabelled && index < 2 ? ['metal'] : [chip.id];
      const itunesId = 8500 + index;
      this.artists.set(itunesId, { name, chips });
      return {
        itunesId,
        kind: 'album' as const,
        name: `${chip.label} Album ${index + 1}`,
        creator: name,
        year: 2020,
        image: this.artwork ? `https://cdn.example.test/albums/${itunesId}.jpg` : undefined,
        chips,
      };
    });
  }

  async resolveDeezerArtist(name: string): Promise<{ id: number; name: string }> {
    return { id: 1, name };
  }

  async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    return deezerArtistId === 4101 ? this.branch.slice(0, limit) : [];
  }

  async enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    const key = name.trim().toLowerCase();
    for (const [itunesArtistId, artist] of this.artists) {
      if (artist.name.toLowerCase() === key) {
        this.wildcardEnrichments.push(artist.name);
        return { itunesArtistId, chips: artist.chips };
      }
    }
    const card = this.branch.find((candidate) => candidate.creatorKey === key);
    return card ? { itunesArtistId: 9000, chips: card.chips } : null;
  }

  async artistAlbums(itunesArtistId: number, limit: number): Promise<Card[]> {
    return this.releases(itunesArtistId, limit, 'album');
  }

  async artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
    return this.releases(itunesArtistId, limit, 'song');
  }

  async samplePreview(): Promise<undefined> {
    return undefined;
  }

  private releases(itunesArtistId: number, limit: number, kind: Card['kind']): Card[] {
    const artist = this.artists.get(itunesArtistId);
    if (!artist) return [];
    return [1, 2].slice(0, limit).map((n) => ({
      key: `it:${kind}:${itunesArtistId}${n}`,
      kind,
      source: 'itunes' as const,
      title: `${artist.name} ${kind} ${n}`,
      creator: artist.name,
      creatorKey: artist.name.toLowerCase(),
      chips: artist.chips,
      image: `https://cdn.example.test/${kind}/${itunesArtistId}${n}.jpg`,
    }));
  }
}

const FAR_SHORE: Card = {
  key: 'dz:artist:6002',
  kind: 'artist',
  source: 'deezer',
  title: 'Far Shore',
  creator: 'Far Shore',
  creatorKey: 'far shore',
  image: 'https://cdn.example.test/artists/6002.jpg',
  chips: ['dance'],
};

/**
 * Glass Harbour is only reachable through Ada Vale, and its own profile opens
 * Far Shore: a second hop a seed-only refill can never reach.
 */
class SecondHopCatalog extends FakeCatalog {
  readonly relatedCalls: number[] = [];

  override async resolveDeezerArtist(name: string) {
    return name.trim().toLowerCase() === 'glass harbour' ? { id: 5101, name } : super.resolveDeezerArtist(name);
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    this.relatedCalls.push(deezerArtistId);
    if (deezerArtistId === 5101) return [FAR_SHORE];
    return super.relatedArtists(deezerArtistId, limit);
  }

  override async enrichArtist(name: string) {
    return name.trim().toLowerCase() === FAR_SHORE.creatorKey
      ? { itunesArtistId: 6002, chips: FAR_SHORE.chips }
      : super.enrichArtist(name);
  }
}

/** Resolves any artist name to a fresh profile, and records the expansion. */
class LikedAnchorCatalog extends FakeCatalog {
  readonly resolved: string[] = [];
  readonly relatedCalls: number[] = [];

  override async resolveDeezerArtist(name: string) {
    const found = await super.resolveDeezerArtist(name);
    if (found) return found;
    this.resolved.push(name.trim().toLowerCase());
    return { id: 9000 + this.resolved.length, name };
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    this.relatedCalls.push(deezerArtistId);
    return deezerArtistId > 9000 ? [] : super.relatedArtists(deezerArtistId, limit);
  }
}

const rosterCard = (name: string, deezerId: number): Card => ({
  key: `dz:artist:${deezerId}`,
  kind: 'artist',
  source: 'deezer',
  title: name,
  creator: name,
  creatorKey: name.toLowerCase(),
  image: `https://cdn.example.test/artists/${deezerId}.jpg`,
  chips: ['rock'],
});

/** Two anchors with several related artists each; records the enrichment order. */
class RotationCatalog extends FakeCatalog {
  readonly enriched: string[] = [];

  constructor(
    private readonly graph: Record<number, Card[]>,
    private readonly budget = Number.POSITIVE_INFINITY,
  ) {
    super();
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    return (this.graph[deezerArtistId] ?? []).slice(0, limit);
  }

  override async enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    this.enriched.push(name.trim().toLowerCase());
    // The shared iTunes budget: past it, lookups resolve empty like a cool-down.
    if (this.enriched.length > this.budget) return null;
    return { itunesArtistId: 10_000 + this.enriched.length, chips: ['rock'] };
  }
}

const ROTATION: Record<number, Card[]> = {
  4101: [rosterCard('A One', 7101), rosterCard('A Two', 7102), rosterCard('A Three', 7103)],
  4102: [rosterCard('B One', 7201), rosterCard('B Two', 7202), rosterCard('B Three', 7203)],
};

describe('generateCandidates', () => {
  it('returns only artist cards, none seen and none a seed artist', async () => {
    const cards = await generateCandidates(new FakeCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.kind === 'artist')).toBe(true);
    expect(cards.every((card) => !SEED_ARTIST_KEYS.has(card.creatorKey))).toBe(true);
    expect(cards.every((card) => card.related && card.related.length > 0)).toBe(true);
  });

  it('gives every artist card its genre from enrichment, not only the first few', async () => {
    const cards = await generateCandidates(new UnenrichedCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards.length).toBeGreaterThan(5);
    expect(cards.every((card) => card.chips.length > 0)).toBe(true);
  });

  it('never deals an artist it could not tag', async () => {
    const cards = await generateCandidates(new UnknownArtistCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards.some((card) => card.creatorKey === 'glass harbour')).toBe(false);
    expect(cards.every((card) => card.chips.length > 0)).toBe(true);
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

  it('falls back to the next same-name profile when the chosen one has no related artists', async () => {
    const cards = await generateCandidates(
      new DuplicateProfileCatalog(),
      UNRESOLVED_SEEDS.slice(0, 1),
      'artist',
      new Set(),
    );

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.related?.includes('ada vale'))).toBe(true);
  });

  it('resolves a seed’s dead stored deezer id by name instead of dealing nothing', async () => {
    const catalog = new DeadStoredIdCatalog();

    const cards = await generateCandidates(catalog, DEAD_SEEDS, 'artist', new Set());

    expect(catalog.resolved).toEqual(['ada vale']);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.related?.includes('ada vale'))).toBe(true);
  });

  it('resolves by name when the stored id answers with an unknown error', async () => {
    const catalog = new UnknownErrorStoredIdCatalog();

    const cards = await generateCandidates(catalog, DEAD_SEEDS, 'artist', new Set());

    expect(catalog.resolved).toEqual(['ada vale']);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('does not spend a name lookup on a stored id when the catalog is simply down', async () => {
    const catalog = new OutageStoredIdCatalog();

    await expect(generateCandidates(catalog, DEAD_SEEDS, 'artist', new Set())).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'network',
    });

    expect(catalog.resolved).toEqual([]);
  });

  it('never retries a dead deezer id within the same generation run', async () => {
    const catalog = new DeadStoredIdCatalog();

    await generateCandidates(catalog, DEAD_SEEDS, 'artist', new Set());

    expect(catalog.relatedCalls.filter((id) => id === DEAD_PROFILE_ID)).toHaveLength(1);
  });

  it('makes no name lookup for a stored deezer id that has related artists', async () => {
    const catalog = new DeadStoredIdCatalog();

    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set());

    expect(catalog.resolved).toEqual([]);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('deals candidates when every seed resolves to the duplicate-profile shape', async () => {
    const cards = await generateCandidates(new DuplicateProfileCatalog(), UNRESOLVED_SEEDS, 'artist', new Set());

    expect(new Set(cards.flatMap((card) => card.related ?? [])).size).toBe(2);
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

  it.each(['artist', 'album', 'song'] as const)(
    'rejects as a budget error when %s enrichment cools down, not as a dry deck',
    async (cardType) => {
      await expect(
        generateCandidates(new CoolingCatalog(), ARTIST_SEEDS, cardType, new Set()),
      ).rejects.toMatchObject({ name: 'CatalogError', kind: 'budget' });
    },
  );

  it('lets only the first artist the deck deals wait out a cool-down', async () => {
    const catalog = new WaitingCatalog();
    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
      waitForFirstCard: true,
    });

    expect(cards.length).toBeGreaterThan(0);
    expect(catalog.enrichWaits[0]).toBe(true);
    expect(catalog.enrichWaits.slice(1).every((wait) => !wait)).toBe(true);
  });

  it('lets the first song’s enrichment and lookup wait out a cool-down', async () => {
    const catalog = new WaitingCatalog();
    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'song', new Set(), {
      waitForFirstCard: true,
    });

    expect(cards.length).toBeGreaterThan(0);
    expect(catalog.enrichWaits[0]).toBe(true);
    expect(catalog.enrichWaits.slice(1).every((wait) => !wait)).toBe(true);
    expect(catalog.releaseWaits[0]).toBe(true);
    expect(catalog.releaseWaits.slice(1).every((wait) => !wait)).toBe(true);
  });

  it('never makes a background refill wait while the deck still has cards', async () => {
    const catalog = new WaitingCatalog();
    await generateCandidates(catalog, ARTIST_SEEDS, 'song', new Set());

    expect([...catalog.enrichWaits, ...catalog.releaseWaits].every((wait) => !wait)).toBe(true);
  });

  it.each(['album', 'song'] as const)(
    'keeps waiting for the budget on later artists while no %s card exists yet',
    async (cardType) => {
      const catalog = new CoolingFirstUnknownCatalog();

      const cards = await generateCandidates(catalog, ARTIST_SEEDS, cardType, new Set(), {
        waitForFirstCard: true,
      });

      expect(cards.length).toBeGreaterThan(0);
      // Glass Harbour has no iTunes match: the wait moves on to the next artist
      // instead of the card being given up on.
      expect(catalog.enrichWaits[0]).toBe(true);
      expect(catalog.enrichWaits[1]).toBe(true);
      expect(catalog.releaseWaits[0]).toBe(true);
      // A card exists now, so the artists after it stop holding the deck for a token.
      expect(catalog.enrichWaits.slice(2).every((wait) => !wait)).toBe(true);
      expect(catalog.releaseWaits.slice(1).every((wait) => !wait)).toBe(true);
    },
  );

  it('keeps waiting for the budget until an artist actually gets tags', async () => {
    const catalog = new CoolingUntaggedPrefixCatalog();

    const cards = await generateCandidates(catalog, [ARTIST_SEEDS[0]], 'artist', new Set(), {
      waitForFirstCard: true,
    });

    expect(cards.map((card) => card.creatorKey)).toEqual(['tag three']);
    // null and chips-less answers are not a tagged artist: keep waiting.
    expect(catalog.enrichWaits.slice(0, 3)).toEqual([true, true, true]);
    expect(catalog.enrichWaits[3]).toBe(false);
  });

  it('bounds the wait so a seed whose related artists all miss ends without failing', async () => {
    const catalog = new CoolingUntaggableCatalog();

    const cards = await generateCandidates(catalog, [ARTIST_SEEDS[0]], 'artist', new Set(), {
      waitForFirstCard: true,
    });

    expect(cards).toEqual([]);
    expect(catalog.enrichWaits.filter(Boolean)).toHaveLength(WAIT_ARTIST_LIMIT);
    expect(catalog.enrichWaits.length).toBeGreaterThan(WAIT_ARTIST_LIMIT);
  });

  it('reports the outage, not a later cool-down, when both leave nothing to deal', async () => {
    await expect(
      generateCandidates(new MixedFailureCatalog(), ARTIST_SEEDS, 'album', new Set()),
    ).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });
  });

  it('treats a catalog answer of "nothing there" as an empty deck, not an outage', async () => {
    const cards = await generateCandidates(new NotFoundCatalog(), ARTIST_SEEDS, 'artist', new Set());

    expect(cards).toEqual([]);
  });

  it('expands a liked artist as a second-hop anchor, never dealing it or a seed', async () => {
    const catalog = new SecondHopCatalog();
    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
      likedAnchors: [{ name: 'Glass Harbour', creatorKey: 'glass harbour' }],
    });

    expect(catalog.relatedCalls).toContain(5101);
    const secondHop = cards.filter((card) => card.creatorKey === 'far shore');
    expect(secondHop).toHaveLength(1);
    expect(secondHop[0].related).toEqual(['glass harbour']);
    expect(
      cards.some((card) => card.creatorKey === 'glass harbour' || SEED_ARTIST_KEYS.has(card.creatorKey)),
    ).toBe(false);
  });

  it('expands at most LIKED_ANCHOR_LIMIT liked anchors per refill', async () => {
    const catalog = new LikedAnchorCatalog();
    const likedAnchors = Array.from({ length: LIKED_ANCHOR_LIMIT + 1 }, (_, index) => ({
      name: `Liked ${index}`,
      creatorKey: `liked ${index}`,
    }));

    await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), { likedAnchors });

    expect(LIKED_ANCHOR_LIMIT).toBeLessThan(likedAnchors.length);
    expect(catalog.resolved).toHaveLength(LIKED_ANCHOR_LIMIT);
  });

  it('spends the enrichment budget round-robin across anchors, not anchor by anchor', async () => {
    const catalog = new RotationCatalog(ROTATION, 4);

    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set());

    expect(catalog.enriched.slice(0, 4)).toEqual(['a one', 'b one', 'a two', 'b two']);
    expect(cards.map((card) => card.creatorKey)).toEqual(['a one', 'b one', 'a two', 'b two']);
  });

  it('does not enrich a candidate the pool already holds', async () => {
    const catalog = new RotationCatalog(ROTATION, 6);

    const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
      poolCreatorKeys: new Set(['a one']),
    });

    expect(catalog.enriched).not.toContain('a one');
    expect(cards.some((card) => card.creatorKey === 'a one')).toBe(false);
  });

  describe('wildcards', () => {
    /** The curated chip the first genre search explored; it must be unpicked. */
    const exploredChip = (catalog: WildcardCatalog): Chip => {
      const seedChips = new Set(ARTIST_SEEDS.flatMap((seed) => seed.chips));
      const chip = CHIPS.find((candidate) => candidate.label === catalog.searches[0]?.term)?.id;
      expect(chip).toBeDefined();
      expect(seedChips.has(chip as Chip)).toBe(false);
      expect(TOP_CHIPS.includes(chip as Chip)).toBe(false);
      return chip as Chip;
    };

    it('finds a wildcard through an album search of a curated chip the listener has not picked', async () => {
      const catalog = new WildcardCatalog();

      const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
        wildcards: true,
        topChips: TOP_CHIPS,
      });

      const wildcards = cards.filter((card) => card.wildcard);
      expect(wildcards.length).toBeGreaterThan(0);
      // The album entity is what makes the term find the genre: an artist
      // search only returns acts named after it (and no artwork at all).
      expect(catalog.searches.every((search) => search.type === 'album')).toBe(true);
      const chip = exploredChip(catalog);
      expect(wildcards.every((card) => card.chips.includes(chip))).toBe(true);
      expect(wildcards.every((card) => card.chips.every((entry) => !TOP_CHIPS.includes(entry)))).toBe(true);
      // Album hits carry artwork, so an artist card is not a blank placeholder.
      expect(wildcards.every((card) => card.image !== undefined)).toBe(true);
      // The regular deck is still there.
      expect(cards.some((card) => !card.wildcard)).toBe(true);
    });

    it.each(['artist', 'album', 'song'] as const)(
      'deals a wildcard %s even when the search hits carry no artwork',
      async (cardType) => {
        const catalog = new WildcardCatalog(ON_TASTE_BRANCH, false);

        const cards = await generateCandidates(catalog, ARTIST_SEEDS, cardType, new Set(), {
          wildcards: true,
          topChips: TOP_CHIPS,
        });

        const wildcards = cards.filter((card) => card.wildcard);
        expect(wildcards.length).toBeGreaterThan(0);
        expect(wildcards.every((card) => card.kind === cardType)).toBe(true);
        // A song's release brings its own artwork; the hit's is not needed.
        if (cardType === 'song') expect(wildcards.every((card) => card.image !== undefined)).toBe(true);
      },
    );

    it('rejects a hit whose own genre is not the chip it explored', async () => {
      const catalog = new WildcardCatalog(ON_TASTE_BRANCH, true, true);

      const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
        wildcards: true,
        topChips: TOP_CHIPS,
      });

      const chip = exploredChip(catalog);
      const wildcards = cards.filter((card) => card.wildcard);
      expect(wildcards.length).toBeGreaterThan(0);
      expect(wildcards.every((card) => card.chips.includes(chip))).toBe(true);
      // The first two hits are only titled after the genre: never enriched.
      expect(catalog.wildcardEnrichments.map((name) => name.toLowerCase())).not.toContain('outside act 1');
      expect(catalog.wildcardEnrichments.map((name) => name.toLowerCase())).not.toContain('outside act 2');
    });

    it('requests no wildcard candidates when the setting is off', async () => {
      const catalog = new WildcardCatalog();

      const cards = await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
        wildcards: false,
        topChips: TOP_CHIPS,
      });

      expect(cards.some((card) => card.wildcard)).toBe(false);
      expect(catalog.searches).toEqual([]);
      expect(catalog.wildcardEnrichments).toEqual([]);
    });

    it('spends at most WILDCARD_ENRICH_LIMIT iTunes enrichments per refill', async () => {
      const catalog = new WildcardCatalog();

      await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(), {
        wildcards: true,
        topChips: TOP_CHIPS,
      });

      expect(catalog.wildcardEnrichments.length).toBeLessThanOrEqual(WILDCARD_ENRICH_LIMIT);
    });

    it('never deals a wildcard the listener has already seen', async () => {
      const first = await generateCandidates(new WildcardCatalog(), ARTIST_SEEDS, 'song', new Set(), {
        wildcards: true,
        topChips: TOP_CHIPS,
      });
      const seen = new Set([first.find((card) => card.wildcard)?.key as string]);

      const again = await generateCandidates(new WildcardCatalog(), ARTIST_SEEDS, 'song', seen, {
        wildcards: true,
        topChips: TOP_CHIPS,
      });

      expect(again.some((card) => card.wildcard && seen.has(card.key))).toBe(false);
      expect(again.every((card) => !seen.has(card.key))).toBe(true);
    });

    it('rotates the explored chip by refill, never by the swipes already seen', async () => {
      const searchTerm = async (turn: number, seen: string[]) => {
        const catalog = new WildcardCatalog();
        await generateCandidates(catalog, ARTIST_SEEDS, 'artist', new Set(seen), {
          wildcards: true,
          topChips: TOP_CHIPS,
          wildcardTurn: turn,
        });
        return catalog.searches[0]?.term;
      };

      // Same refill turn, different swipe counts: the same chip, so its 24 h
      // cache entry serves the repeat.
      expect(await searchTerm(1, [])).toBe(await searchTerm(1, ['a', 'b', 'c']));
      // The next refill explores a different chip.
      expect(await searchTerm(1, [])).not.toBe(await searchTerm(2, []));
    });

    it.each(['album', 'song'] as const)(
      'deals wildcard %s cards with artwork and chips outside the taste',
      async (cardType) => {
        const catalog = new WildcardCatalog();

        const cards = await generateCandidates(catalog, ARTIST_SEEDS, cardType, new Set(), {
          wildcards: true,
          topChips: TOP_CHIPS,
        });

        const wildcards = cards.filter((card) => card.wildcard);
        expect(wildcards.length).toBeGreaterThan(0);
        expect(wildcards.every((card) => card.kind === cardType)).toBe(true);
        expect(wildcards.every((card) => card.image !== undefined && card.chips.length > 0)).toBe(true);
        expect(wildcards.every((card) => card.chips.every((chip) => !TOP_CHIPS.includes(chip)))).toBe(true);
      },
    );
  });
});
