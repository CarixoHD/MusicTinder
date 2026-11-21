import type { Card, Chip, TasteWeights } from '../types';
import { rank } from './taste';

// Seed-balanced re-rank (ADR 7): relevance still orders cards inside a branch,
// but the dealt order interleaves branches so one dominant chip or seed cannot
// take every slot. Pure and synchronous: the deck calls it on its swipe commit.

/** How many already-dealt cards the rules look back at (a window of 6). */
export const DIVERSITY_HISTORY = 6;
/** At most MAX_SAME_CHIP cards with the same top chip in any CHIP_WINDOW dealt. */
const CHIP_WINDOW = 5;
const MAX_SAME_CHIP = 3;
/** Every branch with candidates shows up at least once per BRANCH_WINDOW cards. */
const BRANCH_WINDOW = 6;

/** The chip that groups a card for the "at most 3 of 5" rule. */
export function topChip(card: Card, taste: TasteWeights): Chip | undefined {
  let best: Chip | undefined;
  let bestWeight = -Infinity;
  for (const chip of card.chips) {
    const weight = taste.chips[chip] ?? 0;
    // Ties keep the card's own chip order, so the grouping never depends on taste noise.
    if (weight > bestWeight) {
      best = chip;
      bestWeight = weight;
    }
  }
  return best;
}

/** The seed branch a card belongs to: its related anchor, else its top chip. */
export function branchOf(card: Card, taste: TasteWeights): string {
  return card.related?.[0] ?? topChip(card, taste) ?? card.creatorKey;
}

interface Mark {
  chip?: Chip;
  branch: string;
}

/**
 * `cards` are re-ordered into a deal order. `recent` is what was already dealt
 * (oldest first), so the windows carry across deck commits. Relevance breaks
 * every tie; the rules only lift a due branch or skip a chip that already has
 * three of the last four cards.
 */
export function diversify(taste: TasteWeights, cards: readonly Card[], recent: readonly Card[] = []): Card[] {
  if (cards.length < 2) return [...cards];

  const markCache = new Map<string, Mark>();
  const markOf = (card: Card): Mark => {
    let mark = markCache.get(card.key);
    if (!mark) {
      mark = { chip: topChip(card, taste), branch: branchOf(card, taste) };
      markCache.set(card.key, mark);
    }
    return mark;
  };

  const remaining = rank(taste, [...cards]);
  const window = recent.slice(-DIVERSITY_HISTORY).map(markOf);
  const dealt: Card[] = [];

  while (remaining.length > 0) {
    const index = chooseIndex(remaining, window, markOf);
    const [card] = remaining.splice(index, 1);
    dealt.push(card);
    window.push(markOf(card));
    if (window.length > DIVERSITY_HISTORY) window.shift();
  }

  return dealt;
}

function chooseIndex(remaining: readonly Card[], window: readonly Mark[], markOf: (card: Card) => Mark): number {
  // A fourth card with a chip already in three of the last four would break the
  // 5-window rule, unless the pool has nothing else to deal.
  const chipCounts = new Map<Chip, number>();
  for (const mark of window.slice(-(CHIP_WINDOW - 1))) {
    if (mark.chip) chipCounts.set(mark.chip, (chipCounts.get(mark.chip) ?? 0) + 1);
  }
  const blocked = (mark: Mark) => mark.chip !== undefined && (chipCounts.get(mark.chip) ?? 0) >= MAX_SAME_CHIP;

  // A branch absent from the last five cards would miss the next 6-card window.
  const seenBranches = new Set(window.slice(-(BRANCH_WINDOW - 1)).map((mark) => mark.branch));
  const due = (mark: Mark) => !seenBranches.has(mark.branch);

  const first = (accept: (mark: Mark) => boolean, skipBlocked: boolean): number => {
    for (let index = 0; index < remaining.length; index += 1) {
      const mark = markOf(remaining[index]);
      if (accept(mark) && !(skipBlocked && blocked(mark))) return index;
    }
    return -1;
  };

  // Relevance already orders `remaining`, so the first match is the best card
  // of the branch that must show now; otherwise the best card of any other chip.
  const unblocked = first(due, true);
  if (unblocked !== -1) return unblocked;
  const differentChip = first(() => true, true);
  if (differentChip !== -1) return differentChip;
  // Every remaining card repeats the busy chip: keep the 6-card branch rule and
  // fall back to relevance, because the 5-card chip rule cannot hold anyway.
  const dueIndex = first(due, false);
  return dueIndex === -1 ? 0 : dueIndex;
}
