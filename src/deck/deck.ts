import { applyFeedback, score, topTasteChips } from '../taste/taste';
import { DIVERSITY_HISTORY, diversify } from '../taste/diversity';
import { CatalogError } from '../types';
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
import { generateCandidates, type LikedAnchor } from './generate';

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
  /** Deal exploration cards; matches settings.wildcards, on by default. */
  wildcards?: boolean;
}

/**
 * Why a refill left nothing to deal. 'no-candidates' is a seeds problem on a
 * deck with no history; 'filtered' means the listener has already been through
 * what the catalog offers (or it all fell below the quality floor).
 */
export type EmptyReason = 'no-candidates' | 'filtered' | null;

export interface DeckState {
  /** Unseen candidates that clear the quality floor, best first. */
  pool: Card[];
  status: DeckStatus;
  /** null whenever the pool has cards; drives the Discovery zero-candidates copy. */
  emptyReason: EmptyReason;
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
  /** Follows settings.wildcards; queued wildcards drop at the next commit/refill. */
  setWildcards: (enabled: boolean) => void;
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

/** How many cards since the last wildcard, read from the tail of the deal history. */
const runSinceWildcard = (cards: readonly Card[]): number => {
  let run = 0;
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (cards[index].wildcard) break;
    run += 1;
  }
  return run;
};

/**
 * ADR 7 exploration slot: about every sixth dealt card is a wildcard, never two
 * in a row. `since` counts regulars dealt since the last wildcard, so the
 * cadence carries across commits and refills.
 */
function slotWildcards(regular: readonly Card[], wildcards: readonly Card[], since: number): Card[] {
  const out: Card[] = [];
  let run = since;
  let next = 0;
  let index = 0;
  while (index < regular.length) {
    if (next < wildcards.length && run >= 5) {
      out.push(wildcards[next]);
      next += 1;
      run = 0;
      continue;
    }
    const take = next < wildcards.length ? Math.min(5 - run, regular.length - index) : regular.length - index;
    out.push(...regular.slice(index, index + take));
    index += take;
    run += take;
  }
  // A leftover wildcard may follow the last regular, unless that would put two
  // wildcards back to back with nothing regular between them.
  for (; next < wildcards.length; next += 1) {
    if (regular.length > 0 && out[out.length - 1]?.wildcard) break;
    out.push(wildcards[next]);
  }
  return out;
}

export function createDeck(init: DeckInit): Deck {
  const seen = new Set(init.seen ?? []);
  let wildcardsOn = init.wildcards ?? false;
  let state: DeckState = {
    pool: [],
    status: 'dealing',
    emptyReason: null,
    taste: init.taste,
    swipes: 0,
  };
  let pending: Promise<DeckState> | null = null;
  /** Counts refills: successive wildcard genre searches explore different chips. */
  let refills = 0;
  // The last cards dealt, oldest first: the diversity windows carry across
  // commits, so the interleaving keeps its promise as the pool shrinks.
  const recent: Card[] = [];
  // Artists liked this deck, most recent first: second-hop anchors for the next
  // refill. `generateCandidates` caps how many of them it expands.
  const likedAnchors: LikedAnchor[] = [];
  const rememberLiked = (card: Card) => {
    const at = likedAnchors.findIndex((anchor) => anchor.creatorKey === card.creatorKey);
    if (at !== -1) likedAnchors.splice(at, 1);
    likedAnchors.unshift({ name: card.creator, creatorKey: card.creatorKey });
  };

  // Unseen, above the quality floor (story 10), relevance-ordered per branch,
  // then interleaved so one seed branch cannot take every slot (ADR 7). Each
  // card carries the `because you like X` its current score supports. `visible`
  // leading cards are already on screen and keep their place: only the pool
  // behind them re-ranks, so a refill never swaps the card under a swipe.
  const ranked = (taste: TasteWeights, cards: Card[], visible = 0): Card[] => {
    const unique = new Map<string, Card>();
    for (const card of cards) {
      if (!seen.has(card.key) && !unique.has(card.key)) unique.set(card.key, card);
    }
    const queued = [...unique.values()];
    // Turning wildcards off drops queued exploration at the next commit/refill;
    // only the card already on screen stays, since replacing it under the
    // listener would be worse than showing one last wildcard.
    const all =
      wildcardsOn || visible === 0
        ? queued
        : queued.filter((card, index) => !card.wildcard || index === 0);
    // The current card and the prefetched stack are already rendered; a refill
    // may only reorder what comes after them.
    const shown = all.slice(0, visible);
    const shownKeys = new Set(shown.map((card) => card.key));
    // A wildcard is exempt from the quality floor (it sits outside the taste by
    // design) but never from seen-exclusion.
    const wildcards = wildcardsOn
      ? all.filter((card) => card.wildcard && !shownKeys.has(card.key))
      : [];
    const regular = all.filter(
      (card) => !card.wildcard && !shownKeys.has(card.key) && score(taste, card).score >= 0,
    );
    const history = [...recent, ...shown].filter((card) => !card.wildcard);
    const rest = diversify(taste, regular, history);
    const ordered = [...shown, ...slotWildcards(rest, wildcards, runSinceWildcard([...recent, ...shown]))];
    return ordered.map((card) => {
      if (card.wildcard) return { ...card, because: undefined };
      const because = score(taste, card).because;
      return because ? { ...card, because } : card;
    });
  };

  const refill = (): Promise<DeckState> => {
    pending ??= (async () => {
      try {
        const generated = await generateCandidates(init.catalog, init.seeds, init.cardType, seen, {
          likedAnchors,
          poolCreatorKeys: new Set(state.pool.map((card) => card.creatorKey)),
          // A deck with nothing to deal waits out the app's own iTunes
          // cool-down instead of reporting the catalog as unreachable.
          waitForFirstCard: state.pool.length === 0,
          wildcards: wildcardsOn,
          topChips: topTasteChips(state.taste),
          wildcardTurn: refills++,
        });
        // The current card and the prefetched stack are already rendered; a
        // refill may only reorder what comes after them.
        const visible = Math.min(state.pool.length, 1 + PREFETCH_AHEAD);
        const pool = ranked(state.taste, [...state.pool, ...generated], visible);
        state = {
          ...state,
          pool,
          status: pool.length > 0 ? 'dealing' : 'empty',
          emptyReason:
            pool.length > 0
              ? null
              : generated.length === 0 && seen.size === 0
                ? 'no-candidates'
                : 'filtered',
          swipes: 0,
        };
      } catch (error) {
        // A rejected refill keeps the cards already in hand and surfaces
        // `stalled` so the caller can offer a retry. The app's own iTunes
        // allowance is different: with cards to deal nothing failed on the
        // network, so the deck keeps swiping; with none, the artists it left
        // unchecked make this a retryable cool-down, never the seeds' fault and
        // never the outage copy.
        const coolingDown = error instanceof CatalogError && error.kind === 'budget';
        if (!coolingDown) {
          state = { ...state, status: 'stalled' };
        } else if (state.pool.length === 0) {
          state = { ...state, status: 'cooling', emptyReason: null };
        }
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
    recent.push(current);
    if (recent.length > DIVERSITY_HISTORY) recent.shift();
    init.sink?.setTaste(taste);
    init.sink?.markSeen(current.key);
    if (reaction.reaction === 'like') {
      init.sink?.addLiked(likedFrom(current));
      rememberLiked(current);
    }

    const pool = ranked(taste, state.pool.slice(1));
    state = {
      ...state,
      pool,
      // A failed refill stays flagged through swipes, even once its cards run
      // out: only a successful refill clears it. Otherwise the deck-end copy
      // would blame the seeds while the catalog is the thing that is down.
      status: state.status === 'stalled' ? 'stalled' : pool.length > 0 ? 'dealing' : 'empty',
      taste,
      swipes: state.swipes + 1,
    };
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
      (state.status === 'stalled' ||
        state.swipes >= REFILL_EVERY ||
        state.pool.length < MIN_POOL),
    setWildcards: (enabled) => {
      wildcardsOn = enabled;
    },
  };
}
