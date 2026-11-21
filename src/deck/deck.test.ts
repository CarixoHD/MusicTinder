import { describe, expect, it, vi } from 'vitest';
import { FakeCatalog } from '../testkit/fakeCatalog';
import { initTaste, score } from '../taste/taste';
import {
  CatalogError,
  type Card,
  type Catalog,
  type Chip,
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
  constructor(private readonly cards: Card[]) {}

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

  async samplePreview(): Promise<string | undefined> {
    return undefined;
  }
}

class FlakyCatalog extends FixedCatalog {
  failing = true;
  kind: 'network' | 'rate' = 'network';

  override async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    if (this.failing) throw new CatalogError(this.kind, this.kind);
    return super.relatedArtists(deezerArtistId, limit);
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
    const deck = createDeck({
      catalog: new FakeCatalog(),
      seeds,
      cardType: 'artist',
      taste,
      seen: ['dz:artist:5101'],
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
