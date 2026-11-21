import { describe, expect, it } from 'vitest';
import type { Card, Seed } from '../types';
import { applyFeedback, applyInverse, initTaste, rank, score, topTasteChips } from './taste';

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

  it('lowers a wildcard’s chips by half of a normal skip at the same elapsed time', () => {
    const taste = initTaste([GENRE_SEED]);
    const wildcard = card({
      key: 'wildcard',
      title: 'Something Else',
      creator: 'Surprise Act',
      creatorKey: 'surprise act',
      chips: ['jazz'],
      wildcard: true,
    });
    const normal = applyFeedback(taste, { card: { ...wildcard, wildcard: undefined }, reaction: 'skip', elapsedMs: 9000 });
    const explored = applyFeedback(taste, { card: wildcard, reaction: 'skip', elapsedMs: 9000 });

    expect(explored.delta.chips.jazz).toBe((normal.delta.chips.jazz ?? 0) / 2);
    expect(explored.delta.chips.jazz).not.toBe(0);
  });

  it('likes a wildcard exactly like any other card', () => {
    const taste = initTaste([GENRE_SEED]);
    const wildcard = card({ key: 'w', creator: 'Surprise Act', creatorKey: 'surprise act', chips: ['rock'], wildcard: true });
    const normal = applyFeedback(taste, { card: { ...wildcard, wildcard: undefined }, reaction: 'like', elapsedMs: 9000 });
    const liked = applyFeedback(taste, { card: wildcard, reaction: 'like', elapsedMs: 9000 });

    expect(liked).toEqual(normal);
  });
});

describe('topTasteChips', () => {
  it('returns the listener’s strongest three chips, strongest first', () => {
    const taste = { chips: { rock: 1, jazz: 0.5, pop: 0.25, blues: 0.125 }, creators: {}, origins: {} };

    expect(topTasteChips(taste)).toEqual(['rock', 'jazz', 'pop']);
  });

  it('leaves disliked chips out: a wildcard only has to stay outside what the listener likes', () => {
    expect(topTasteChips({ chips: { rock: 1, metal: -2 }, creators: {}, origins: {} })).toEqual(['rock']);
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

describe('popularity dampener', () => {
  const known = card({ key: 'known', creator: 'Daft Punk', creatorKey: 'daft punk', chips: ['electronic'], fans: 5_200_000 });
  const lesserKnown = card({ key: 'lesser-known', creator: 'Anoraak', creatorKey: 'anoraak', chips: ['electronic'], fans: 18_000 });

  it('ranks the lesser-known artist first when taste fit is equal', () => {
    const taste = initTaste([{ id: 'seed-electronic', kind: 'genre', name: 'Electronic', chips: ['electronic'] }]);

    expect(rank(taste, [known, lesserKnown]).map((c) => c.key)).toEqual(['lesser-known', 'known']);
    expect(rank(taste, [lesserKnown, known]).map((c) => c.key)).toEqual(['lesser-known', 'known']);
  });

  it('never lets a fan-count penalty overturn a like-driven lift', () => {
    const taste = initTaste([GENRE_SEED]);
    const liked = card({ key: 'liked', title: 'Loud Guitars', creator: 'Rock Band', creatorKey: 'rock band', chips: ['rock'] });
    const { taste: afterLike } = applyFeedback(taste, { card: liked, reaction: 'like', elapsedMs: 4000 });

    const popularLikedFamily = card({ key: 'family', creator: 'Big Rock', creatorKey: 'big rock', chips: ['rock'], fans: 5_200_000 });
    const obscureNoFit = card({ key: 'obscure', creator: 'Nobody', creatorKey: 'nobody', chips: ['metal'], fans: 12 });

    expect(score(afterLike, popularLikedFamily).score).toBeGreaterThan(score(afterLike, obscureNoFit).score);
    expect(rank(afterLike, [obscureNoFit, popularLikedFamily]).map((c) => c.key)).toEqual(['family', 'obscure']);
  });

  it('reports the undampened taste fit, so the deck floor never drops a popular card', () => {
    const taste = initTaste([GENRE_SEED]);
    const noFans = card({ key: 'no-fans', creator: 'A', creatorKey: 'a', chips: ['jazz'] });

    expect(score(taste, noFans).score).toBe(taste.chips.jazz);
    expect(score(taste, { ...noFans, fans: 5_200_000 }).score).toBe(taste.chips.jazz);
    // Ordering still favours the lesser-known card.
    expect(rank(taste, [noFans, { ...noFans, key: 'famous', fans: 5_200_000 }]).map((c) => c.key)).toEqual([
      'no-fans',
      'famous',
    ]);
  });

  it('keeps a high-fan card whose only fit is its anchor above the deck quality floor', () => {
    const taste = initTaste([ARTIST_SEED]);
    const anchorOnly = card({
      key: 'anchor-only',
      creator: 'Glass Harbour',
      creatorKey: 'glass harbour',
      chips: ['other'],
      related: ['ada vale'],
      fans: 3_000_000,
    });

    expect(score(taste, anchorOnly).score).toBeGreaterThan(0);
    expect(score(taste, anchorOnly).score).toBe(score(taste, { ...anchorOnly, fans: undefined }).score);
    // The dampener still only orders: an equally fitting obscure card comes first.
    const lesserKnown = { ...anchorOnly, key: 'lesser-known', fans: 12 };
    expect(rank(taste, [anchorOnly, lesserKnown]).map((c) => c.key)).toEqual(['lesser-known', 'anchor-only']);
  });
});
