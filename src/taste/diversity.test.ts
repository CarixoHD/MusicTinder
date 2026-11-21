import { describe, expect, it } from 'vitest';
import type { Card, Chip, Seed, TasteWeights } from '../types';
import { applyFeedback, initTaste } from './taste';
import { branchOf, diversify, topChip } from './diversity';

const chipSeed = (name: string, chip: Chip): Seed => ({ id: `seed-${name}`, kind: 'genre', name, chips: [chip] });

function card(key: string, chip: Chip, branch?: string, overrides: Partial<Card> = {}): Card {
  return {
    key,
    kind: 'artist',
    source: 'deezer',
    title: key,
    creator: key,
    creatorKey: key,
    chips: [chip],
    related: branch === undefined ? undefined : [branch],
    ...overrides,
  };
}

/** Deal `count` cards the way the deck does: re-rank the rest after every card. */
function deal(taste: TasteWeights, cards: readonly Card[], count: number, history: Card[] = []): Card[] {
  let pool = [...cards];
  const recent = [...history];
  const dealt: Card[] = [];
  while (pool.length > 0 && dealt.length < count) {
    pool = diversify(taste, pool, recent);
    const next = pool.shift();
    if (!next) break;
    dealt.push(next);
    recent.push(next);
  }
  return dealt;
}

const chipsIn = (cards: readonly Card[]): Chip[] => cards.map((c) => c.chips[0]);

describe('diversify', () => {
  it('deals a minority branch early even when its cards are famously dampened', () => {
    // The bug: three electronic seeds stack the chip weight, and the R&B branch's
    // huge fan counts push it below every electronic card in the raw ranking.
    const taste = initTaste([
      chipSeed('Electronic One', 'electronic'),
      chipSeed('Electronic Two', 'electronic'),
      chipSeed('Electronic Three', 'electronic'),
      chipSeed('R&B', 'r&b-soul'),
    ]);
    const electronic = ['e1', 'e2', 'e3'].flatMap((branch) =>
      Array.from({ length: 6 }, (_, index) => card(`${branch}-${index}`, 'electronic', branch, { fans: 4_000 })),
    );
    const rnb = Array.from({ length: 5 }, (_, index) =>
      card(`rnb-${index}`, 'r&b-soul', 'the-weeknd', { fans: 5_000_000 }),
    );

    const dealt = deal(taste, [...electronic, ...rnb], 12);

    expect(dealt.slice(0, 6).some((c) => c.chips.includes('r&b-soul'))).toBe(true);
    expect(dealt.slice(0, 12).filter((c) => c.chips.includes('r&b-soul')).length).toBeGreaterThanOrEqual(2);
  });

  it('never deals more than three of one top chip in any five consecutive cards', () => {
    const taste = initTaste([chipSeed('Electronic', 'electronic'), chipSeed('R&B', 'r&b-soul'), chipSeed('Jazz', 'jazz')]);
    const pool = [
      ...Array.from({ length: 12 }, (_, i) => card(`e-${i}`, 'electronic', `e${i % 3}`)),
      ...Array.from({ length: 6 }, (_, i) => card(`r-${i}`, 'r&b-soul', 'r')),
      ...Array.from({ length: 6 }, (_, i) => card(`j-${i}`, 'jazz', 'j')),
    ];

    const dealt = deal(taste, pool, pool.length);

    for (let start = 0; start + 5 <= dealt.length; start += 1) {
      const window = chipsIn(dealt.slice(start, start + 5));
      for (const chip of new Set(window)) {
        expect(window.filter((other) => other === chip).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('surfaces every branch at least once in every six cards', () => {
    const taste = initTaste([chipSeed('Electronic', 'electronic'), chipSeed('R&B', 'r&b-soul'), chipSeed('Jazz', 'jazz')]);
    // Every branch still has candidates left throughout the checked windows.
    const pool = [
      ...Array.from({ length: 30 }, (_, i) => card(`e-${i}`, 'electronic', 'electronic-branch')),
      ...Array.from({ length: 20 }, (_, i) => card(`r-${i}`, 'r&b-soul', 'r-branch')),
      ...Array.from({ length: 20 }, (_, i) => card(`j-${i}`, 'jazz', 'j-branch')),
    ];

    const dealt = deal(taste, pool, 30);

    for (let start = 0; start + 6 <= dealt.length; start += 1) {
      const branches = new Set(dealt.slice(start, start + 6).map((c) => branchOf(c, taste)));
      expect(branches).toEqual(new Set(['electronic-branch', 'r-branch', 'j-branch']));
    }
  });

  it('lets likes grow a branch’s share of the next cards while other branches keep appearing', () => {
    const base = [chipSeed('Electronic One', 'electronic'), chipSeed('Electronic Two', 'electronic'), chipSeed('R&B', 'r&b-soul')];
    let taste = initTaste(base);
    const pool = [
      ...Array.from({ length: 18 }, (_, i) => card(`e-${i}`, 'electronic', `e${i % 2}`)),
      ...Array.from({ length: 16 }, (_, i) => card(`r-${i}`, 'r&b-soul', 'r')),
    ];

    const recent: Card[] = [];
    const before = deal(taste, pool, 10, recent);
    const dealt = new Set(before.map((c) => c.key));
    const rest = pool.filter((c) => !dealt.has(c.key));

    // Several likes on the R&B branch: ranking still learns from them.
    for (const liked of rest.filter((c) => c.chips.includes('r&b-soul')).slice(0, 3)) {
      taste = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 9000 }).taste;
    }
    const after = deal(taste, rest, 10, before);

    const rnb = (cards: Card[]) => cards.filter((c) => c.chips.includes('r&b-soul')).length;
    expect(rnb(after)).toBeGreaterThan(rnb(before));
    // The others are still dealt, just less often.
    expect(after.some((c) => topChip(c, taste) === 'electronic')).toBe(true);
  });

  it('keeps each branch’s cards in relevance order', () => {
    const seed = chipSeed('Electronic', 'electronic');
    const taste = initTaste([seed]);
    const lesserKnown = card('newcomer', 'electronic', 'e', { fans: 100 });
    const famous = card('famous', 'electronic', 'e', { fans: 5_000_000, title: 'famous' });
    const pool = [famous, lesserKnown];

    expect(diversify(taste, pool, []).map((c) => c.key)).toEqual(['newcomer', 'famous']);
  });

  it('keeps every card exactly once', () => {
    const taste = initTaste([chipSeed('Electronic', 'electronic'), chipSeed('R&B', 'r&b-soul')]);
    const pool = [
      ...Array.from({ length: 40 }, (_, i) => card(`e-${i}`, 'electronic', `e${i % 3}`)),
      ...Array.from({ length: 5 }, (_, i) => card(`r-${i}`, 'r&b-soul', 'r')),
    ];

    const dealt = diversify(taste, pool, []);

    expect(dealt.map((c) => c.key).sort()).toEqual(pool.map((c) => c.key).sort());
  });

  it('re-ranks a 100-card pool synchronously and fast', () => {
    const taste = initTaste([chipSeed('Electronic', 'electronic'), chipSeed('R&B', 'r&b-soul')]);
    const pool = [
      ...Array.from({ length: 80 }, (_, i) => card(`e-${i}`, 'electronic', `e${i % 3}`)),
      ...Array.from({ length: 20 }, (_, i) => card(`r-${i}`, 'r&b-soul', 'r')),
    ];

    const started = performance.now();
    const dealt = diversify(taste, pool, []);
    const elapsed = performance.now() - started;

    expect(Array.isArray(dealt)).toBe(true);
    expect(dealt).toHaveLength(100);
    // The deck's commit budget; generous enough for a busy CI box.
    expect(elapsed).toBeLessThan(50);
  });
});
