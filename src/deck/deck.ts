import { applyFeedback, rank, score } from '../taste/taste';
import type {
  Card,
  CardKind,
  Catalog,
  DeckStatus,
  LikedItem,
  Reaction,
  Seed,
  TasteWeights,
} from '../types';
import { generateCandidates } from './generate';

// Hot path (ARCHITECTURE §deck): a swipe is one synchronous commit. Network work
// only ever happens in refill, off the commit path.

/** Refill in the background once the queue dips below this. */
export const MIN_POOL = 15;
/** …or after this many swipes, so a big pool is still kept fresh. */
export const REFILL_EVERY = 8;
/** Cards rendered ahead of the current one. */
export const PREFETCH_AHEAD = 5;

/** Persistence seam: the deck owns the hot path, the store owns the write. */
export interface DeckSink {
  setTaste: (taste: TasteWeights) => void;
  markSeen: (key: string) => void;
  addLiked: (item: LikedItem) => void;
}

export interface DeckInit {
  catalog: Catalog;
  seeds: Seed[];
  cardType: CardKind;
  taste: TasteWeights;
  seen?: readonly string[];
  sink?: DeckSink;
}

export interface DeckState {
  /** Unseen candidates that clear the quality floor, best first. */
  pool: Card[];
  status: DeckStatus;
  taste: TasteWeights;
  /** Swipes since the last successful refill; drives the refill cadence. */
  swipes: number;
}

export interface Deck {
  readonly state: DeckState;
  refill: () => Promise<DeckState>;
  commit: (reaction: Reaction) => DeckState;
  prefetchQueue: (state?: DeckState) => Card[];
  shouldRefill: () => boolean;
}

const likedFrom = (card: Card): LikedItem => ({
  key: card.key,
  kind: card.kind,
  title: card.title,
  creator: card.creator,
  creatorKey: card.creatorKey,
  year: card.year,
  image: card.image,
  previewUrl: card.previewUrl,
  appleUrl: card.appleUrl,
  chips: card.chips,
  because: card.because,
});

export function createDeck(init: DeckInit): Deck {
  const seen = new Set(init.seen ?? []);
  let state: DeckState = { pool: [], status: 'dealing', taste: init.taste, swipes: 0 };
  let pending: Promise<DeckState> | null = null;

  // Unseen, above the quality floor (story 10), best first, each carrying the
  // `because you like X` its current score supports.
  const ranked = (taste: TasteWeights, cards: Card[]): Card[] => {
    const unique = new Map<string, Card>();
    for (const card of cards) {
      if (!seen.has(card.key) && !unique.has(card.key)) unique.set(card.key, card);
    }
    const passing = [...unique.values()].filter((card) => score(taste, card).score >= 0);
    return rank(taste, passing).map((card) => {
      const because = score(taste, card).because;
      return because ? { ...card, because } : card;
    });
  };

  const refill = (): Promise<DeckState> => {
    pending ??= (async () => {
      try {
        const generated = await generateCandidates(init.catalog, init.seeds, init.cardType, seen);
        const pool = ranked(state.taste, [...state.pool, ...generated]);
        state = { ...state, pool, status: pool.length > 0 ? 'dealing' : 'empty', swipes: 0 };
      } catch {
        // A rejected refill keeps the cards already in hand and surfaces
        // `stalled` so the caller can offer a retry.
        state = { ...state, status: 'stalled' };
      }
      return state;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };

  const commit = (reaction: Reaction): DeckState => {
    const current = state.pool[0];
    if (!current || current.key !== reaction.card.key) return state;

    const { taste } = applyFeedback(state.taste, reaction);
    seen.add(current.key);
    init.sink?.setTaste(taste);
    init.sink?.markSeen(current.key);
    if (reaction.reaction === 'like') init.sink?.addLiked(likedFrom(current));

    const pool = ranked(taste, state.pool.slice(1));
    state = { pool, status: pool.length > 0 ? 'dealing' : 'empty', taste, swipes: state.swipes + 1 };
    return state;
  };

  return {
    get state() {
      return state;
    },
    refill,
    commit,
    prefetchQueue: (current = state) => current.pool.slice(1, 1 + PREFETCH_AHEAD),
    shouldRefill: () =>
      pending === null &&
      state.status !== 'stalled' &&
      (state.swipes >= REFILL_EVERY || state.pool.length < MIN_POOL),
  };
}
