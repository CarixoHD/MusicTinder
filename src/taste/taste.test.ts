import { describe, expect, it } from 'vitest';
import type { Card, Seed } from '../types';
import { applyFeedback, applyInverse, initTaste, rank, score } from './taste';

function card(overrides: Partial<Card> & Pick<Card, 'key'>): Card {
  return {
    kind: 'song',
    source: 'itunes',
    title: overrides.key,
    creator: 'Somebody',
    creatorKey: 'somebody',
    chips: [],
    ...overrides,
  };
}

const ARTIST_SEED: Seed = {
  id: 'seed-artist',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  deezerArtistId: 4101,
  chips: ['ambient'],
};

const GENRE_SEED: Seed = {
  id: 'seed-genre',
  kind: 'genre',
  name: 'Jazz',
  chips: ['jazz'],
};

describe('initTaste', () => {
  it('weights seed chips and seed creators, recording where each feature came from', () => {
    const taste = initTaste([ARTIST_SEED, GENRE_SEED]);

    expect(taste.chips.ambient).toBeGreaterThan(0);
    expect(taste.chips.jazz).toBeGreaterThan(0);
    expect(taste.creators['ada vale']).toBeGreaterThan(0);
    expect(taste.origins.ambient).toBe('Ada Vale');
    expect(taste.origins['ada vale']).toBe('Ada Vale');
    expect(taste.origins.jazz).toBe('Jazz');
    // A genre seed has no creator of its own.
    expect(taste.creators.jazz).toBeUndefined();
  });
});

describe('applyFeedback', () => {
  const liked = card({
    key: 'liked',
    title: 'Loud Guitars',
    creator: 'Rock Band',
    creatorKey: 'rock band',
    chips: ['rock'],
  });
  const sameChip = card({ key: 'same-chip', creator: 'Other Band', creatorKey: 'other band', chips: ['rock'] });
  const sameCreator = card({ key: 'same-creator', creator: 'Rock Band', creatorKey: 'rock band', chips: [] });
  const unrelated = card({ key: 'unrelated', creator: 'Jazz Cat', creatorKey: 'jazz cat', chips: ['jazz'] });

  it('a like makes cards sharing its chips or creator rank higher relative to unrelated cards', () => {
    const taste = initTaste([GENRE_SEED]);
    const chipGap = (t: typeof taste) => score(t, sameChip).score - score(t, unrelated).score;
    const creatorGap = (t: typeof taste) => score(t, sameCreator).score - score(t, unrelated).score;

    const { taste: afterLike } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 4000 });

    expect(chipGap(afterLike)).toBeGreaterThan(chipGap(taste));
    expect(creatorGap(afterLike)).toBeGreaterThan(creatorGap(taste));
  });

  it('a skip makes cards sharing its chips or creator rank lower relative to unrelated cards', () => {
    const taste = initTaste([GENRE_SEED]);
    const likedTaste = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 4000 }).taste;
    const chipGap = (t: typeof taste) => score(t, sameChip).score - score(t, unrelated).score;
    const creatorGap = (t: typeof taste) => score(t, sameCreator).score - score(t, unrelated).score;

    const { taste: afterSkip } = applyFeedback(likedTaste, { card: liked, reaction: 'skip', elapsedMs: 9000 });

    expect(chipGap(afterSkip)).toBeLessThan(chipGap(likedTaste));
    expect(creatorGap(afterSkip)).toBeLessThan(creatorGap(likedTaste));
  });

  it('discounts a fast skip (<5s) against a slow one', () => {
    const taste = initTaste([GENRE_SEED]);
    const fast = applyFeedback(taste, { card: liked, reaction: 'skip', elapsedMs: 1200 });
    const slow = applyFeedback(taste, { card: liked, reaction: 'skip', elapsedMs: 9000 });

    expect(Math.abs(fast.delta.chips.rock ?? 0)).toBeLessThan(Math.abs(slow.delta.chips.rock ?? 0));
    expect(fast.delta.chips.rock).not.toBe(0);
  });
});

describe('applyInverse', () => {
  it('restores the previous taste exactly after a like', () => {
    const taste = initTaste([ARTIST_SEED, GENRE_SEED]);
    const liked = card({ key: 'l', title: 'New Find', creator: 'Rock Band', creatorKey: 'rock band', chips: ['rock'] });

    const { taste: after, delta } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 8000 });

    expect(applyInverse(after, delta)).toEqual(taste);
  });

  it('restores the previous taste exactly after a slow and a fast skip', () => {
    const taste = initTaste([ARTIST_SEED, GENRE_SEED]);
    const skipped = card({ key: 's', title: 'Not For Me', creator: 'Ada Vale', creatorKey: 'ada vale', chips: ['ambient', 'jazz'] });

    for (const elapsedMs of [1200, 9000]) {
      const { taste: after, delta } = applyFeedback(taste, { card: skipped, reaction: 'skip', elapsedMs });
      expect(applyInverse(after, delta)).toEqual(taste);
    }
  });

  it('does not mutate the taste it is given', () => {
    const taste = initTaste([GENRE_SEED]);
    const liked = card({ key: 'l', title: 'New Find', creator: 'Rock Band', creatorKey: 'rock band', chips: ['rock'] });
    const { taste: after, delta } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 8000 });

    const before = structuredClone(after);
    applyInverse(after, delta);

    expect(after).toEqual(before);
  });
});

describe('score', () => {
  it('names the seed behind the strongest contributing chip', () => {
    const taste = initTaste([GENRE_SEED]);
    const jazz = card({ key: 'j', creator: 'Newcomer', creatorKey: 'newcomer', chips: ['jazz'] });

    expect(score(taste, jazz)).toMatchObject({ because: 'Jazz' });
  });

  it('names the liked item once a like made it the strongest contributor', () => {
    const taste = initTaste([GENRE_SEED]);
    const liked = card({ key: 'l', title: 'Neon Nights', creator: 'Neon Band', creatorKey: 'neon band', chips: ['electronic'] });
    const { taste: after } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 4000 });
    const electronic = card({ key: 'e', creator: 'Someone Else', creatorKey: 'someone else', chips: ['electronic'] });

    expect(score(after, electronic)).toMatchObject({ because: 'Neon Nights' });
  });

  it('scores a card related to a liked anchor artist above an unrelated one', () => {
    const taste = initTaste([ARTIST_SEED]);
    const liked = card({ key: 'l', title: 'Ada Hit', creator: 'Ada Vale', creatorKey: 'ada vale', chips: ['other'] });
    const { taste: after } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 4000 });

    const related = card({ key: 'r', creator: 'Glass Harbour', creatorKey: 'glass harbour', chips: ['other'], related: ['ada vale'] });
    const unrelated = card({ key: 'u', creator: 'Nobody', creatorKey: 'nobody', chips: ['other'] });

    expect(score(after, related).score).toBeGreaterThan(score(after, unrelated).score);
    expect(score(after, related).because).toBe('Ada Hit');
  });

  it('has no because when nothing contributes positively', () => {
    const taste = initTaste([]);
    const unknown = card({ key: 'x', creator: 'Nobody', creatorKey: 'nobody', chips: ['metal'] });

    expect(score(taste, unknown)).toEqual({ score: 0 });
  });
});

describe('rank', () => {
  it('sorts by score descending and keeps ties in their original order', () => {
    const taste = initTaste([GENRE_SEED]);
    const first = card({ key: 'first', creator: 'A', creatorKey: 'a', chips: [] });
    const jazz = card({ key: 'jazz', creator: 'B', creatorKey: 'b', chips: ['jazz'] });
    const second = card({ key: 'second', creator: 'C', creatorKey: 'c', chips: [] });

    expect(rank(taste, [first, jazz, second]).map((c) => c.key)).toEqual(['jazz', 'first', 'second']);
  });
});
