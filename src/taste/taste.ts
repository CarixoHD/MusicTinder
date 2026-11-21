import type { Card, Chip, Reaction, Seed, TasteDelta, TasteWeights } from '../types';

// Rocchio-style relevance feedback over chips + creators (docs/research/).
// Power-of-two constants keep every weight a binary fraction, so an additive
// delta can be subtracted back to the exact previous weights (applyInverse).
const BETA = 0.5;
const GAMMA = 0.25;
const ALPHA = 0.5; // weight of a shared anchor artist (card.related)
const FAST_SKIP_MS = 5000;
const FAST_SKIP_FACTOR = 0.5;

// Popularity dampener: mild per-decade penalty so an equally fitting lesser-known
// artist outranks a famous one. Capped below one like (BETA), so taste fit still
// dominates a fan-count gap. Cards without a fan count are not dampened at all.
// It only orders (rank); it never feeds score(), which the deck filters as its
// quality floor — otherwise a popular card would be dropped, not just pushed down.
const POPULARITY_PER_DECADE = 0.05;
const MAX_POPULARITY_PENALTY = BETA * 0.9;

const popularityPenalty = (fans: number | undefined): number =>
  fans && fans > 0 ? Math.min(POPULARITY_PER_DECADE * Math.log10(fans), MAX_POPULARITY_PENALTY) : 0;

/** Sentinel in `delta.origins`: the feature had no origin before the reaction. */
const NO_ORIGIN = '';

const creatorKeyOf = (seed: Seed): string => seed.creatorKey ?? seed.name.trim().toLowerCase();

export function initTaste(seeds: Seed[]): TasteWeights {
  const taste: TasteWeights = { chips: {}, creators: {}, origins: {} };

  for (const seed of seeds) {
    for (const chip of new Set(seed.chips)) {
      taste.chips[chip] = (taste.chips[chip] ?? 0) + BETA;
      taste.origins[chip] = seed.name;
    }
    // A genre seed only contributes its chip; it has no artist of its own.
    if (seed.kind !== 'genre') {
      const creatorKey = creatorKeyOf(seed);
      taste.creators[creatorKey] = (taste.creators[creatorKey] ?? 0) + BETA;
      taste.origins[creatorKey] = seed.name;
    }
  }

  return taste;
}

/**
 * A like raises the card's chips and creator; a skip lowers exactly the same
 * features (never a family-wide penalty) and is discounted when it came fast.
 * Pure: returns fresh taste + an additive, invertible delta.
 */
export function applyFeedback(
  taste: TasteWeights,
  reaction: Reaction,
): { taste: TasteWeights; delta: TasteDelta } {
  const { card, reaction: kind, elapsedMs } = reaction;
  const isLike = kind === 'like';
  const amount = isLike ? BETA : -GAMMA * (elapsedMs < FAST_SKIP_MS ? FAST_SKIP_FACTOR : 1);

  const next: TasteWeights = {
    chips: { ...taste.chips },
    creators: { ...taste.creators },
    origins: { ...taste.origins },
  };
  const delta: TasteDelta = { chips: {}, creators: {}, origins: {} };

  // Only a like re-attributes a feature; remember what it was so undo can restore it.
  const rememberOrigin = (feature: string) => {
    if (!(feature in delta.origins)) delta.origins[feature] = taste.origins[feature] ?? NO_ORIGIN;
  };

  // Weights never keep a stored 0, so a feature created by this reaction
  // vanishes again on inverse instead of lingering as a 0-valued key.
  for (const chip of new Set(card.chips)) {
    const weight = (next.chips[chip] ?? 0) + amount;
    delta.chips[chip] = amount;
    if (weight === 0) delete next.chips[chip];
    else next.chips[chip] = weight;
    if (isLike && weight > 0) {
      rememberOrigin(chip);
      next.origins[chip] = card.title;
    }
  }

  if (card.creatorKey) {
    const weight = (next.creators[card.creatorKey] ?? 0) + amount;
    delta.creators[card.creatorKey] = amount;
    if (weight === 0) delete next.creators[card.creatorKey];
    else next.creators[card.creatorKey] = weight;
    if (isLike && weight > 0) {
      rememberOrigin(card.creatorKey);
      next.origins[card.creatorKey] = card.title;
    }
  }

  return { taste: next, delta };
}

export function applyInverse(taste: TasteWeights, delta: TasteDelta): TasteWeights {
  const next: TasteWeights = {
    chips: { ...taste.chips },
    creators: { ...taste.creators },
    origins: { ...taste.origins },
  };

  for (const [chip, amount] of Object.entries(delta.chips) as [Chip, number][]) {
    const weight = (next.chips[chip] ?? 0) - amount;
    if (weight === 0) delete next.chips[chip];
    else next.chips[chip] = weight;
  }
  for (const [creatorKey, amount] of Object.entries(delta.creators)) {
    const weight = (next.creators[creatorKey] ?? 0) - amount;
    if (weight === 0) delete next.creators[creatorKey];
    else next.creators[creatorKey] = weight;
  }
  for (const [feature, origin] of Object.entries(delta.origins)) {
    if (origin === NO_ORIGIN) delete next.origins[feature];
    else next.origins[feature] = origin;
  }

  return next;
}

/**
 * Dot product over the card's chips, its creator, and its anchor creators
 * (shared-artist similarity, weighted by ALPHA). `because` names the origin of
 * the strongest positive contributor. This is the undampened taste fit: callers
 * may use it as a threshold, so popularity must never pull it down.
 */
export function score(taste: TasteWeights, card: Card): { score: number; because?: string } {
  const contributors: { feature: string; weight: number }[] = [
    ...[...new Set(card.chips)].map((chip) => ({ feature: chip, weight: taste.chips[chip] ?? 0 })),
  ];
  if (card.creatorKey) {
    contributors.push({ feature: card.creatorKey, weight: taste.creators[card.creatorKey] ?? 0 });
  }
  for (const anchor of new Set(card.related ?? [])) {
    contributors.push({ feature: anchor, weight: ALPHA * (taste.creators[anchor] ?? 0) });
  }

  const total = contributors.reduce((sum, contributor) => sum + contributor.weight, 0);
  const strongest = contributors
    .filter((contributor) => contributor.weight > 0 && taste.origins[contributor.feature])
    .reduce<{ feature: string; weight: number } | undefined>(
      (best, contributor) => (best && best.weight >= contributor.weight ? best : contributor),
      undefined,
    );

  return strongest ? { score: total, because: taste.origins[strongest.feature] } : { score: total };
}

/** Score desc after the popularity dampener, stable: equal scores keep their incoming order. */
export function rank(taste: TasteWeights, cards: Card[]): Card[] {
  return cards
    .map((card, index) => ({ card, index, score: score(taste, card).score - popularityPenalty(card.fans) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.card);
}
