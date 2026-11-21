import { describe, expect, it, vi } from 'vitest';
import { FakeCatalog } from '../testkit/fakeCatalog';
import { initTaste, score } from '../taste/taste';
import { topChip } from '../taste/diversity';
import {
  CatalogError,
  type Card,
  type Catalog,
  type Chip,
  type LookupOptions,
  type Sample,
  type Seed,
  type SeedCandidate,
  type TasteWeights,
} from '../types';
import { createDeck, PREFETCH_AHEAD } from './deck';

const ADA: Seed = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

const NORTH: Seed = {
  id: 'seed-north',
  kind: 'artist',
  name: 'North Static',
  creatorKey: 'north static',
  itunesArtistId: 9102,
  deezerArtistId: 4102,
  chips: ['indie', 'rock'],
};

const ANCHOR: Seed = {
  id: 'seed-anchor',
  kind: 'artist',
  name: 'Anchor',
  creatorKey: 'anchor',
  deezerArtistId: 1,
  chips: ['rock'],
};

const artistCard = (id: number, chip: Chip): Card => ({
  key: `dz:artist:${id}`,
  kind: 'artist',
  source: 'deezer',
  title: `${chip} ${id}`,
  creator: `${chip} ${id}`,
  creatorKey: `${chip} ${id}`,
  image: `https://cdn.example.test/artists/${id}.jpg`,
  chips: [chip],
});

/** A catalog whose related-artist spine is exactly the cards a test needs. */
class FixedCatalog implements Catalog {
  constructor(readonly cards: Card[]) {}

  async searchSeeds(): Promise<SeedCandidate[]> {
    return [];
  }

  async resolveDeezerArtist(name: string) {
    return { id: 1, name };
  }

  async relatedArtists(_deezerArtistId: number, limit: number): Promise<Card[]> {
    return this.cards.slice(0, limit);
  }

  /** Mirrors the live catalog: the genre of a related artist comes from iTunes. */
  async enrichArtist(name: string) {
    const index = this.cards.findIndex((card) => card.creatorKey === name.trim().toLowerCase());
    return index === -1 ? null : { itunesArtistId: 1000 + index, chips: this.cards[index].chips };
  }

  async artistTopTracks(): Promise<Card[]> {
    return [];
  }

  async artistAlbums(): Promise<Card[]> {
    return [];
  }

  async samplePreview(): Promise<Sample | undefined> {
    return undefined;
  }
}

class FlakyCatalog extends FixedCatalog {
  failing = true;
  kind: 'network' | 'rate' | 'budget' = 'network';

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (this.failing) throw new CatalogError(this.kind, this.kind);
    return super.relatedArtists(deezerArtistId, limit);
  }
}

/** A catalog where every seed anchor opens its own branch of related artists. */
class BranchCatalog implements Catalog {
  private readonly branches = new Map<number, Card[]>();
  private readonly chipsByCreator = new Map<string, Chip[]>();

  constructor(branches: { deezerArtistId: number; cards: Card[] }[]) {
    for (const branch of branches) {
      this.branches.set(branch.deezerArtistId, branch.cards);
      for (const card of branch.cards) this.chipsByCreator.set(card.creatorKey, card.chips);
    }
  }

  async searchSeeds(): Promise<SeedCandidate[]> {
    return [];
  }

  async resolveDeezerArtist(name: string) {
    return { id: 1, name };
  }

  async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    return (this.branches.get(deezerArtistId) ?? []).slice(0, limit);
  }

  async enrichArtist(name: string) {
    const chips = this.chipsByCreator.get(name.trim().toLowerCase());
    return chips ? { itunesArtistId: 7000 + this.chipsByCreator.size, chips } : null;
  }

  async artistTopTracks(): Promise<Card[]> {
    return [];
  }

  async artistAlbums(): Promise<Card[]> {
    return [];
  }

  async samplePreview(): Promise<Sample | undefined> {
    return undefined;
  }
}

/**
 * Two seed branches: a large one on the listener's taste and a small one on a
 * chip they never picked, whose cards are therefore wildcard candidates.
 */
class WildcardBranchCatalog implements Catalog {
  readonly searches: string[] = [];
  private readonly branchCards = new Map<number, Card[]>();

  constructor() {
    this.branchCards.set(
      4101,
      Array.from({ length: 10 }, (_, index) => artistCard(100 + index, 'electronic')),
    );
    // The least-represented branch: two cards outside the top chips.
    this.branchCards.set(
      4102,
      Array.from({ length: 2 }, (_, index) => artistCard(200 + index, 'pop')),
    );
  }

  async searchSeeds(term: string): Promise<SeedCandidate[]> {
    this.searches.push(term);
    return [
      {
        itunesId: 8800,
        kind: 'artist',
        name: 'Outside Surprise',
        creator: 'Outside Surprise',
        image: 'https://cdn.example.test/artists/8800.jpg',
        chips: ['pop'],
      },
    ];
  }

  async resolveDeezerArtist(name: string) {
    return { id: 1, name };
  }

  async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    return (this.branchCards.get(deezerArtistId) ?? []).slice(0, limit);
  }

  async enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    if (name.trim().toLowerCase() === 'outside surprise') {
      return { itunesArtistId: 8800, chips: ['pop'] };
    }
    const card = [...this.branchCards.values()].flat().find((entry) => entry.creatorKey === name.trim().toLowerCase());
    return card ? { itunesArtistId: 5000, chips: card.chips } : null;
  }

  async artistTopTracks(): Promise<Card[]> {
    return [];
  }

  async artistAlbums(): Promise<Card[]> {
    return [];
  }

  async samplePreview(): Promise<Sample | undefined> {
    return undefined;
  }
}

/** More cards than one refill's related-artist limit, for the hot-path test. */
class BigCatalog extends FixedCatalog {
  override async relatedArtists(): Promise<Card[]> {
    return this.cards;
  }
}

/** Deals `first` on the first refill, then `later` — which may score higher. */
class GrowingCatalog extends FixedCatalog {
  private calls = 0;

  constructor(
    private readonly first: Card[],
    private readonly later: Card[],
  ) {
    super([...first, ...later]);
  }

  override async relatedArtists(): Promise<Card[]> {
    this.calls += 1;
    return this.calls === 1 ? this.first : this.later;
  }
}

/** Records whether generation was allowed to wait on the iTunes budget. */
class RecordingCatalog extends FakeCatalog {
  readonly enrichWaits: boolean[] = [];

  override async enrichArtist(name: string, options?: LookupOptions) {
    this.enrichWaits.push(options?.waitForBudget === true);
    return super.enrichArtist(name);
  }
}

/**
 * The iTunes budget is cooling down: only a lookup allowed to wait gets a
 * token, and the first related artist (Glass Harbour) has no iTunes match.
 */
class CoolingFirstUnknownCatalog extends FakeCatalog {
  override async enrichArtist(name: string, options?: LookupOptions) {
    if (options?.waitForBudget !== true) throw new CatalogError('budget', 'iTunes is cooling down');
    return name.trim().toLowerCase() === 'glass harbour' ? null : super.enrichArtist(name);
  }

  override async artistTopTracks(itunesArtistId: number, limit: number, options?: LookupOptions) {
    if (options?.waitForBudget !== true) throw new CatalogError('budget', 'iTunes is cooling down');
    return super.artistTopTracks(itunesArtistId, limit);
  }
}

/** Every related artist is unknown to iTunes while the budget cools down. */
class CoolingUntaggableCatalog extends FakeCatalog {
  override async enrichArtist(_name: string, options?: LookupOptions) {
    if (options?.waitForBudget !== true) throw new CatalogError('budget', 'iTunes is cooling down');
    return null;
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
 * Glass Harbour is only reachable through Ada Vale; its own profile opens Far
 * Shore. Liking it anywhere in the deck must make that second hop dealable.
 */
class SecondHopCatalog extends FakeCatalog {
  override async resolveDeezerArtist(name: string) {
    return name.trim().toLowerCase() === 'glass harbour' ? { id: 5101, name } : super.resolveDeezerArtist(name);
  }

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (deezerArtistId === 5101) return [FAR_SHORE];
    return super.relatedArtists(deezerArtistId, limit);
  }

  override async enrichArtist(name: string) {
    return name.trim().toLowerCase() === FAR_SHORE.creatorKey
      ? { itunesArtistId: 6002, chips: FAR_SHORE.chips }
      : super.enrichArtist(name);
  }
}

const controlledCards = (): Card[] => [
  artistCard(1, 'rock'),
  artistCard(2, 'jazz'),
  artistCard(3, 'rock'),
  artistCard(4, 'ambient'),
  artistCard(5, 'jazz'),
  artistCard(6, 'ambient'),
];

const scoresDescending = (taste: TasteWeights, cards: Card[]): boolean =>
  cards.every((card, index) => {
    if (index === 0) return true;
    return score(taste, cards[index - 1]).score >= score(taste, card).score;
  });

describe('deck refill', () => {
  it('builds a ranked, unseen pool of artist cards from FakeCatalog', async () => {
    const seeds = [ADA, NORTH];
    const taste = initTaste(seeds);
    // Wildcards are exempt from the score floor and slot separately; this test
    // is about the plain relevance order.
    const deck = createDeck({
      catalog: new FakeCatalog(),
      seeds,
      cardType: 'artist',
      taste,
      seen: ['dz:artist:5101'],
      wildcards: false,
    });

    const state = await deck.refill();

    expect(state.status).toBe('dealing');
    expect(state.pool.length).toBeGreaterThan(PREFETCH_AHEAD);
    expect(state.pool.some((card) => card.key === 'dz:artist:5101')).toBe(false);
    expect(new Set(state.pool.map((card) => card.key)).size).toBe(state.pool.length);
    expect(state.pool.every((card) => card.chips.length > 0 && card.image !== undefined)).toBe(true);
    expect(scoresDescending(state.taste, state.pool)).toBe(true);
    expect(state.pool[0].because).toBeDefined();
  });

  it('never replaces the top or next card already on screen when a refill finds better candidates', async () => {
    // Famous cards are dampened, so the newcomer below outranks all of them.
    const onScreen = [1, 2, 3, 4].map((id) => ({
      ...artistCard(id, 'rock'),
      related: ['anchor'],
      fans: 5_000_000,
    }));
    const better = { ...artistCard(99, 'rock'), related: ['anchor'] };
    const deck = createDeck({
      catalog: new GrowingCatalog(onScreen, [...onScreen, better]),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });

    await deck.refill();
    deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 9000 });
    const visible = deck.state.pool.map((card) => card.key);

    const state = await deck.refill();

    // The current card and the one waiting behind it stay where the UI showed
    // them; only the pool behind the visible stack may re-rank.
    expect(state.pool.slice(0, 3).map((card) => card.key)).toEqual(visible);
    expect(state.pool.map((card) => card.key)).toContain(better.key);
  });

  it('keeps at least three upcoming cards ready beyond the current one', async () => {
    const deck = createDeck({
      catalog: new FakeCatalog(),
      seeds: [ADA, NORTH],
      cardType: 'artist',
      taste: initTaste([ADA, NORTH]),
    });
    await deck.refill();

    expect(deck.prefetchQueue()).toEqual(deck.state.pool.slice(1, 1 + PREFETCH_AHEAD));
    expect(deck.prefetchQueue().length).toBeGreaterThanOrEqual(3);
  });

  it('drops candidates below the quality floor and reports an empty deck', async () => {
    const taste: TasteWeights = {
      chips: { rock: -1, jazz: -1, ambient: -1 },
      creators: { anchor: -1 },
      origins: {},
    };
    const deck = createDeck({
      catalog: new FixedCatalog(controlledCards()),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste,
    });

    const state = await deck.refill();

    expect(state.pool).toEqual([]);
    expect(state.status).toBe('empty');
    expect(state.emptyReason).toBe('filtered');
  });

  it('deals a popular related card whose only fit is its anchor, instead of dropping it on the dampener', async () => {
    // No chip fits the seed, so only ALPHA × BETA from the anchor contributes.
    // Its fan count used to push the score below the deck's quality floor.
    const popular: Card = { ...artistCard(7, 'jazz'), fans: 3_000_000 };
    const deck = createDeck({
      catalog: new FixedCatalog([popular]),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });

    const state = await deck.refill();

    expect(state.status).toBe('dealing');
    expect(state.pool.map((card) => card.key)).toEqual([popular.key]);
  });

  it('reports no candidates when the catalog answers with nothing for these seeds', async () => {
    const deck = createDeck({
      catalog: new FixedCatalog([]),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });

    const state = await deck.refill();

    expect(state.pool).toEqual([]);
    expect(state.status).toBe('empty');
    expect(state.emptyReason).toBe('no-candidates');
  });

  it('treats nothing new for a listener with history as the deck end, not empty seeds', async () => {
    const seen = controlledCards().map((card) => card.key);
    const deck = createDeck({
      catalog: new FixedCatalog(controlledCards()),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
      seen,
    });

    const state = await deck.refill();

    expect(state.pool).toEqual([]);
    expect(state.status).toBe('empty');
    expect(state.emptyReason).toBe('filtered');
  });

  it('requests related artists for an artist liked this deck, and deals the second hop', async () => {
    const catalog = new SecondHopCatalog();
    const deck = createDeck({
      catalog,
      seeds: [ADA],
      cardType: 'artist',
      taste: initTaste([ADA]),
    });
    await deck.refill();

    const dealt = new Set<string>();
    while (deck.state.pool[0] && deck.state.pool[0].creatorKey !== 'glass harbour') {
      const card = deck.state.pool[0];
      dealt.add(card.key);
      deck.commit({ card, reaction: 'skip', elapsedMs: 100 });
    }
    const liked = deck.state.pool[0];
    expect(liked.creatorKey).toBe('glass harbour');
    dealt.add(liked.key);
    deck.commit({ card: liked, reaction: 'like', elapsedMs: 9000 });

    const spy = vi.spyOn(catalog, 'relatedArtists');
    const state = await deck.refill();

    expect(spy.mock.calls.map(([deezerArtistId]) => deezerArtistId)).toContain(5101);
    expect(state.pool.some((card) => card.key === FAR_SHORE.key)).toBe(true);
    // The liked anchor, the seed and everything already seen stay out of the deck.
    expect(
      state.pool.some(
        (card) => card.creatorKey === 'glass harbour' || card.creatorKey === 'ada vale' || dealt.has(card.key),
      ),
    ).toBe(false);
  });

  it('uses the artist behind a liked album as an anchor on the next refill', async () => {
    const catalog = new SecondHopCatalog();
    const deck = createDeck({
      catalog,
      seeds: [ADA],
      cardType: 'album',
      taste: initTaste([ADA]),
    });
    await deck.refill();

    while (deck.state.pool[0] && deck.state.pool[0].creatorKey !== 'glass harbour') {
      deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 100 });
    }
    const liked = deck.state.pool[0];
    expect(liked.kind).toBe('album');
    deck.commit({ card: liked, reaction: 'like', elapsedMs: 9000 });

    const spy = vi.spyOn(catalog, 'relatedArtists');
    await deck.refill();

    // Liking an album expands its creator, not the album itself.
    expect(spy.mock.calls.map(([deezerArtistId]) => deezerArtistId)).toContain(5101);
  });

  it('lets the first card’s lookup wait out a cool-down only while the deck has nothing', async () => {
    const catalog = new RecordingCatalog();
    const deck = createDeck({
      catalog,
      seeds: [ADA],
      cardType: 'song',
      taste: initTaste([ADA]),
    });

    const dealt = await deck.refill();

    expect(dealt.status).toBe('dealing');
    expect(catalog.enrichWaits[0]).toBe(true);
  });

  it('deals a fresh deck when the first related artist has no iTunes match and the budget is cooling down', async () => {
    const deck = createDeck({
      catalog: new CoolingFirstUnknownCatalog(),
      seeds: [ADA],
      cardType: 'song',
      taste: initTaste([ADA]),
    });

    const state = await deck.refill();

    expect(state.status).toBe('dealing');
    expect(state.pool.length).toBeGreaterThan(0);
  });

  it('ends a fresh deck empty, not stalled, when the cool-down outlasts every waited artist', async () => {
    const deck = createDeck({
      catalog: new CoolingUntaggableCatalog(),
      seeds: [ADA],
      cardType: 'artist',
      taste: initTaste([ADA]),
    });

    const state = await deck.refill();

    expect(state.status).toBe('empty');
    expect(state.emptyReason).toBe('no-candidates');
    expect(state.pool).toEqual([]);
  });

  it('reports stalled when a refill rejects and deals again after a working retry', async () => {
    const catalog = new FlakyCatalog(controlledCards());
    const deck = createDeck({
      catalog,
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });

    const stalled = await deck.refill();
    expect(stalled.status).toBe('stalled');
    expect(stalled.pool).toEqual([]);

    catalog.failing = false;
    const retried = await deck.refill();

    expect(retried.status).toBe('dealing');
    expect(retried.pool.length).toBe(controlledCards().length);
  });

  it('stalls instead of ending the deck when the catalog cools down for a listener with history', async () => {
    const catalog = new FlakyCatalog(controlledCards());
    catalog.kind = 'rate';
    // Without the rate error this would be "that's everything in this direction".
    const deck = createDeck({
      catalog,
      seeds: [ANCHOR],
      cardType: 'album',
      taste: initTaste([ANCHOR]),
      seen: controlledCards().map((card) => card.key),
    });

    const state = await deck.refill();

    expect(state.status).toBe('stalled');
    expect(state.emptyReason).toBeNull();
  });

  it('keeps the cards in hand after a background refill fails and asks to try again', async () => {
    const catalog = new FlakyCatalog(controlledCards());
    const deck = createDeck({
      catalog,
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });
    catalog.failing = false;
    const dealt = await deck.refill();
    expect(dealt.status).toBe('dealing');

    catalog.failing = true;
    const stalled = await deck.refill();

    expect(stalled.status).toBe('stalled');
    expect(stalled.pool).toEqual(dealt.pool);
    // There are still cards to swipe, so a later swipe must be able to retry
    // the catalog instead of the deck staying stalled forever.
    expect(deck.shouldRefill()).toBe(true);

    while (deck.state.pool.length > 0) {
      deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 100 });
    }
    // Running out of cards while the catalog is down is still a catalog
    // failure, never the deck-end copy that blames the seeds.
    expect(deck.state.status).toBe('stalled');

    catalog.failing = false;
    const recovered = await deck.refill();
    // A successful refill clears the failure; the deck really is exhausted now.
    expect(recovered.status).toBe('empty');
  });

  it('keeps dealing when a background refill only meets the app’s own iTunes cool-down', async () => {
    const catalog = new FlakyCatalog(controlledCards());
    const deck = createDeck({
      catalog,
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });
    catalog.failing = false;
    const dealt = await deck.refill();
    expect(dealt.status).toBe('dealing');

    // The budget is spent, not the catalog down: the listener must keep swiping
    // without an outage notice.
    catalog.kind = 'budget';
    catalog.failing = true;
    const cooled = await deck.refill();

    expect(cooled.status).toBe('dealing');
    expect(cooled.pool).toEqual(dealt.pool);

    const swiped = deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 100 });
    expect(swiped.status).toBe('dealing');

    // An upstream rate limit (Deezer quota, iTunes 403) is a catalog failure
    // even with cards in hand, so it still offers Retry.
    catalog.kind = 'rate';
    const limited = await deck.refill();
    expect(limited.status).toBe('stalled');
  });
});

describe('deck commit', () => {
  const setup = async () => {
    const deck = createDeck({
      catalog: new FixedCatalog(controlledCards()),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });
    await deck.refill();
    return deck;
  };

  it('commits synchronously: taste, seen and the promoted card change before the call returns', async () => {
    const sink = { setTaste: vi.fn(), markSeen: vi.fn(), addLiked: vi.fn() };
    const deck = createDeck({
      catalog: new FixedCatalog(controlledCards()),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
      sink,
    });
    await deck.refill();
    const current = deck.state.pool[0];

    const next = deck.commit({ card: current, reaction: 'like', elapsedMs: 9000 });

    expect(next).toBe(deck.state);
    expect(next.pool.some((card) => card.key === current.key)).toBe(false);
    expect(next.taste.chips.rock).toBeGreaterThan(initTaste([ANCHOR]).chips.rock ?? 0);
    expect(sink.setTaste).toHaveBeenCalledWith(next.taste);
    expect(sink.markSeen).toHaveBeenCalledWith(current.key);
    expect(sink.addLiked).toHaveBeenCalledWith(
      expect.objectContaining({
        key: current.key,
        kind: 'artist',
        title: current.title,
        creator: current.creator,
        creatorKey: current.creatorKey,
        image: current.image,
        chips: current.chips,
      }),
    );
  });

  it('promotes the top-ranked remaining card under the taste a like just changed', async () => {
    const deck = await setup();
    const current = deck.state.pool[0];
    const likedChip = current.chips[0];

    const next = deck.commit({ card: current, reaction: 'like', elapsedMs: 9000 });

    // Rule, not a fixture answer: the promoted card is the best of what is left
    // after the like raised its chip family.
    const best = Math.max(...next.pool.map((card) => score(next.taste, card).score));
    expect(score(next.taste, next.pool[0]).score).toBe(best);
    expect(next.pool[0].chips).toContain(likedChip);

    const family = next.pool.filter((card) => card.chips.includes(likedChip));
    const rest = next.pool.filter((card) => !card.chips.includes(likedChip));
    for (const card of family) {
      for (const other of rest) {
        expect(score(next.taste, card).score).toBeGreaterThan(score(next.taste, other).score);
      }
    }
  });

  it('never deals a seen key again and ends quietly when the pool is exhausted', async () => {
    const deck = createDeck({
      catalog: new FixedCatalog(controlledCards()),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
      seen: ['dz:artist:2'],
    });
    await deck.refill();

    const dealt: string[] = [];
    while (deck.state.pool.length > 0) {
      const card = deck.state.pool[0];
      dealt.push(card.key);
      deck.commit({ card, reaction: 'like', elapsedMs: 9000 });
    }

    expect(dealt).not.toContain('dz:artist:2');
    expect(new Set(dealt).size).toBe(dealt.length);
    expect(deck.state.pool).toEqual([]);
    expect(deck.state.status).toBe('empty');
  });

  it('does not count a card that is not being dealt, so a double tap cannot skip twice', async () => {
    const deck = await setup();
    const before = deck.state;
    const upcoming = before.pool[1];

    expect(deck.commit({ card: upcoming, reaction: 'like', elapsedMs: 100 })).toBe(before);
  });

  it('marks swipes and asks for a background refill as the pool runs low', async () => {
    const deck = await setup();
    const before = deck.state;

    const next = deck.commit({ card: before.pool[0], reaction: 'skip', elapsedMs: 100 });

    expect(next.swipes).toBe(before.swipes + 1);
    expect(deck.shouldRefill()).toBe(next.pool.length < 15);
  });

  it('stays stalled through swipes until a retry succeeds', async () => {
    const catalog = new FlakyCatalog(controlledCards());
    catalog.failing = false;
    const deck = createDeck({
      catalog,
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });
    await deck.refill();

    catalog.failing = true;
    const stalled = await deck.refill();
    expect(stalled.status).toBe('stalled');

    const swiped = deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 100 });
    expect(swiped.status).toBe('stalled');

    catalog.failing = false;
    const retried = await deck.refill();
    expect(retried.status).toBe('dealing');
  });
});

describe('deck diversity', () => {
  const ELECTRONIC_SEEDS: Seed[] = [1, 2, 3].map((n) => ({
    id: `electro-${n}`,
    kind: 'artist',
    name: `Electro ${n}`,
    creatorKey: `electro ${n}`,
    deezerArtistId: 70 + n,
    chips: ['electronic'],
  }));
  const WEEKND_SEED: Seed = {
    id: 'weeknd',
    kind: 'artist',
    name: 'The Weeknd',
    creatorKey: 'the weeknd',
    deezerArtistId: 74,
    chips: ['r&b-soul'],
  };

  const branchCard = (anchor: string, id: number, chip: Chip, fans: number): Card => ({
    key: `dz:artist:${id}`,
    kind: 'artist',
    source: 'deezer',
    title: `${anchor} ${id}`,
    creator: `${anchor} ${id}`,
    creatorKey: `${anchor} ${id}`.toLowerCase(),
    image: `https://cdn.example.test/artists/${id}.jpg`,
    chips: [chip],
    fans,
  });

  const stackedCatalog = () =>
    new BranchCatalog([
      ...ELECTRONIC_SEEDS.map((seed, branch) => ({
        deezerArtistId: seed.deezerArtistId ?? 0,
        cards: Array.from({ length: 6 }, (_, n) => branchCard(`Electro ${branch + 1}`, 100 * branch + n + 1, 'electronic', 3_000)),
      })),
      {
        deezerArtistId: WEEKND_SEED.deezerArtistId ?? 0,
        cards: Array.from({ length: 6 }, (_, n) => branchCard('Weeknd Act', 900 + n, 'r&b-soul', 5_000_000)),
      },
    ]);

  const deal = async (count: number): Promise<{ deck: ReturnType<typeof createDeck>; dealt: Card[] }> => {
    const seeds = [...ELECTRONIC_SEEDS, WEEKND_SEED];
    const deck = createDeck({ catalog: stackedCatalog(), seeds, cardType: 'artist', taste: initTaste(seeds) });
    await deck.refill();
    const dealt: Card[] = [];
    while (dealt.length < count && deck.state.pool.length > 0) {
      const card = deck.state.pool[0];
      dealt.push(card);
      deck.commit({ card, reaction: 'skip', elapsedMs: 3000 });
    }
    return { deck, dealt };
  };

  it('deals the minority R&B seed early among stacked electronic seeds', async () => {
    const { deck, dealt } = await deal(12);

    expect(deck.state).toMatchObject({ status: 'dealing', emptyReason: null });
    expect(dealt.slice(0, 6).some((card) => card.chips.includes('r&b-soul'))).toBe(true);
    expect(dealt.slice(0, 12).filter((card) => card.chips.includes('r&b-soul')).length).toBeGreaterThanOrEqual(2);
  });

  it('never deals more than three of one top chip in any five consecutive cards', async () => {
    const { deck, dealt } = await deal(12);
    const chips = dealt.map((card) => topChip(card, deck.state.taste));

    for (let start = 0; start + 5 <= chips.length; start += 1) {
      const window = chips.slice(start, start + 5);
      for (const chip of new Set(window)) {
        expect(window.filter((other) => other === chip).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('returns the next card from a 100-card pool on a synchronous commit', async () => {
    const cards = Array.from({ length: 100 }, (_, i) => artistCard(1000 + i, i % 2 === 0 ? 'rock' : 'jazz'));
    const deck = createDeck({
      catalog: new BigCatalog(cards),
      seeds: [ANCHOR],
      cardType: 'artist',
      taste: initTaste([ANCHOR]),
    });
    await deck.refill();
    expect(deck.state.pool).toHaveLength(100);

    const started = performance.now();
    const next = deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 100 });
    const elapsed = performance.now() - started;

    expect(next).toBe(deck.state);
    expect(next.pool).toHaveLength(99);
    expect(next.pool[0]).toBeDefined();
    expect(Array.isArray(next.pool)).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

describe('deck wildcards', () => {
  const setup = (wildcards = true, taste = initTaste([ADA, NORTH])) =>
    createDeck({
      catalog: new WildcardBranchCatalog(),
      seeds: [ADA, NORTH],
      cardType: 'artist',
      taste,
      wildcards,
    });

  const deal = async (deck: ReturnType<typeof createDeck>, count: number): Promise<Card[]> => {
    const dealt: Card[] = [];
    while (dealt.length < count && deck.state.pool.length > 0) {
      const card = deck.state.pool[0];
      dealt.push(card);
      // Likes keep the taste (and so the regular pool) stable while dealing.
      deck.commit({ card, reaction: 'like', elapsedMs: 9000 });
    }
    return dealt;
  };

  it('deals about one in six cards as a wildcard, never two in a row', async () => {
    const deck = setup();
    const state = await deck.refill();
    expect(state.pool.filter((card) => card.wildcard)).toHaveLength(2);

    const dealt = await deal(deck, 12);
    const wildcards = dealt.map((card, index) => (card.wildcard ? index + 1 : 0)).filter(Boolean);

    // Every 12 dealt cards carry one or two exploration cards (ADR 7).
    expect(wildcards.length).toBeGreaterThanOrEqual(1);
    expect(wildcards.length).toBeLessThanOrEqual(2);
    expect(wildcards).toEqual([6, 12]);
    for (let index = 1; index < dealt.length; index += 1) {
      expect(Boolean(dealt[index].wildcard && dealt[index - 1].wildcard)).toBe(false);
    }
  });

  it('deals no wildcard and asks the catalog for none when the setting is off', async () => {
    const catalog = new WildcardBranchCatalog();
    const deck = createDeck({
      catalog,
      seeds: [ADA, NORTH],
      cardType: 'artist',
      taste: initTaste([ADA, NORTH]),
      wildcards: false,
    });

    const state = await deck.refill();
    const dealt = await deal(deck, 12);

    expect(state.pool.some((card) => card.wildcard)).toBe(false);
    expect(dealt.some((card) => card.wildcard)).toBe(false);
    expect(catalog.searches).toEqual([]);
  });

  it('explores a different genre chip on each refill, not on every swipe', async () => {
    const catalog = new WildcardBranchCatalog();
    // Both branches are on the listener's taste, so only the genre search can
    // supply a wildcard and it runs on both refills.
    const taste: TasteWeights = { chips: { electronic: 3, pop: 2, ambient: 1 }, creators: {}, origins: {} };
    const deck = createDeck({ catalog, seeds: [ADA, NORTH], cardType: 'artist', taste, wildcards: true });

    await deck.refill();
    await deck.refill();

    expect(catalog.searches).toHaveLength(2);
    expect(catalog.searches[0]).not.toBe(catalog.searches[1]);
  });

  it('drops queued wildcards when turned off mid-session and resumes at the next refill', async () => {
    const deck = setup();
    await deck.refill();
    expect(deck.state.pool.some((card) => card.wildcard)).toBe(true);

    // A refill already drops the queued ones (the current card is regular here).
    deck.setWildcards(false);
    const hidden = await deck.refill();
    expect(hidden.pool.some((card) => card.wildcard)).toBe(false);

    deck.setWildcards(true);
    const resumed = await deck.refill();
    expect(resumed.pool.some((card) => card.wildcard)).toBe(true);

    // A swipe commits without them too.
    deck.setWildcards(false);
    const swiped = deck.commit({ card: deck.state.pool[0], reaction: 'skip', elapsedMs: 9000 });
    expect(swiped.pool.some((card) => card.wildcard)).toBe(false);
  });

  it('keeps a wildcard below the quality floor, but never deals one already seen', async () => {
    const taste: TasteWeights = { chips: { electronic: 1, pop: -2 }, creators: {}, origins: {} };
    const deck = setup(true, taste);

    const state = await deck.refill();
    const wildcards = state.pool.filter((card) => card.wildcard);
    expect(wildcards.length).toBeGreaterThan(0);
    expect(wildcards.every((card) => score(taste, card).score < 0)).toBe(true);

    const dealt = await deal(deck, 12);
    const seen = new Set(dealt.map((card) => card.key));
    const again = await deck.refill();

    expect(again.pool.some((card) => card.wildcard && seen.has(card.key))).toBe(false);
  });
});
