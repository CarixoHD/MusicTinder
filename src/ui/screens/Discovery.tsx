import { useCallback, useEffect, useRef, useState } from 'react';
import { previewPlayer } from '../../audio/player';
import { createCatalog } from '../../catalog';
import { createDeck, type Deck, type DeckState } from '../../deck/deck';
import { useStore } from '../../store/store';
import { initTaste } from '../../taste/taste';
import type { Card as CardModel, CardKind, Catalog, Seed, TasteWeights } from '../../types';
import { Button } from '../Button';
import { Card } from '../Card';
import { DeckNotice } from '../components/DeckNotice';
import { SwipeCard } from '../components/SwipeCard';
import { withTransition } from '../transition';
import './discovery.css';

const tasteIsEmpty = (taste: TasteWeights) =>
  Object.keys(taste.chips).length === 0 && Object.keys(taste.creators).length === 0;

// The deck outlives the Discovery screen: peeking at Liked and coming back is
// normal use and must return to the same card. A session-level deck keeps the
// pool (and its dealt-behind cards) in memory; switching seeds, card type or
// wiping the data (sessionEpoch) builds a new one. Never persisted — a reload
// starts a fresh session.
let session: { key: string; catalog: Catalog | null; deck: Deck } | null = null;

const sessionKey = (seeds: Seed[], cardType: CardKind, epoch: number): string =>
  `${epoch}|${cardType}|${seeds.map((seed) => `${seed.kind}:${seed.id}:${seed.name}`).join('|')}`;

function LikeIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 19.5S5 15.4 5 10.7A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7 2.5c0 4.7-7 8.8-7 8.8Z" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function Discovery({ catalog: injected }: { catalog?: Catalog } = {}) {
  const seeds = useStore((state) => state.seeds);
  const taste = useStore((state) => state.taste);
  const seen = useStore((state) => state.seen);
  const cardType = useStore((state) => state.settings.cardType);
  const sound = useStore((state) => state.settings.sound);
  const setTaste = useStore((state) => state.setTaste);
  const markSeen = useStore((state) => state.markSeen);
  const addLiked = useStore((state) => state.addLiked);
  const setScreen = useStore((state) => state.setScreen);
  const settingsOpen = useStore((state) => state.settingsOpen);

  // The deck belongs to the session, not to this mount: returning from Liked
  // finds the same pool instead of re-dealing from the catalog.
  const [catalog] = useState(() => injected ?? createCatalog());
  const [deck] = useState(() => {
    const key = sessionKey(seeds, cardType, useStore.getState().sessionEpoch);
    if (session && session.key === key && session.catalog === (injected ?? null)) return session.deck;
    const deck = createDeck({
      catalog,
      seeds,
      cardType,
      taste: tasteIsEmpty(taste) && seeds.length > 0 ? initTaste(seeds) : taste,
      seen,
      sink: { setTaste, markSeen, addLiked },
    });
    session = { key, catalog: injected ?? null, deck };
    return deck;
  });
  // The deck belongs to the epoch it was built in; after a wipe its taste must
  // never flow back into the emptied store.
  const deckEpoch = useRef(useStore.getState().sessionEpoch).current;
  const [state, setState] = useState<DeckState>(deck.state);
  const [loading, setLoading] = useState(() => deck.state.status === 'dealing' && !deck.state.pool.length);
  // Previews resolved for cards the catalog ships silent, keyed by card key.
  const [samples, setSamples] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Cards whose lookup has answered; a genuine miss stays "No sample" for good.
  const requested = useRef(new Set<string>());
  // Lookups still waiting on the catalog budget, so a swipe can abandon them.
  const lookups = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const cardStartedAt = useRef(0);
  const player = previewPlayer();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    cardStartedAt.current = performance.now();
  }, []);

  const refill = useCallback(() => {
    // A refill in flight is not the deck's end: an in-hand deck that runs out
    // while a refill is pending shows the "getting ready" state, not "that's
    // everything", until the refill answers.
    setLoading(true);
    deck.refill().then((next) => {
      setState(next);
      setLoading(false);
    });
  }, [deck]);

  const freshDeck = () => {
    setLoading(true);
    refill();
  };

  // Entering with an empty taste derives it from the seeds once, so ranking is
  // meaningful and a reload keeps the same starting point.
  useEffect(() => {
    if (useStore.getState().sessionEpoch !== deckEpoch) return;
    if (tasteIsEmpty(taste) && seeds.length > 0) setTaste(deck.state.taste);
  }, [deck, deckEpoch, seeds.length, setTaste, taste]);

  useEffect(() => {
    // Only a deck that has never been dealt (this mount or a previous visit)
    // needs the initial refill; a retained deck keeps its cards in hand.
    if (deck.state.status !== 'dealing' || deck.state.pool.length > 0) return;
    let cancelled = false;
    deck.refill().then((next) => {
      if (cancelled) return;
      setState(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [deck]);

  const withSample = useCallback(
    (card: CardModel): CardModel => {
      const previewUrl = card.previewUrl ?? samples.get(card.key);
      return previewUrl && previewUrl !== card.previewUrl ? { ...card, previewUrl } : card;
    },
    [samples],
  );

  // Silent artist/album cards ask the catalog for a preview just in time: the
  // current card for its play button, the next one so a swipe can auto-play.
  // Fire-and-forget; the deck never waits. A lookup that meets an iTunes
  // cool-down waits for a refill (the visible card ahead of the prefetch one)
  // and is abandoned when its card leaves, so it cannot hold a token the
  // visible card needs. A genuine miss stays "No sample" for good.
  useEffect(() => {
    const wanted = [state.pool[0], deck.prefetchQueue(state)[0]].filter(
      (card): card is CardModel => card !== undefined && !card.previewUrl,
    );
    const wantedKeys = new Set(wanted.map((card) => card.key));

    for (const [key, controller] of lookups.current) {
      if (wantedKeys.has(key)) continue;
      controller.abort();
      lookups.current.delete(key);
      requested.current.delete(key);
    }

    for (const card of wanted) {
      if (lookups.current.has(card.key) || requested.current.has(card.key)) continue;
      const controller = new AbortController();
      lookups.current.set(card.key, controller);
      void catalog
        .samplePreview(card, {
          waitForBudget: true,
          priority: card.key === state.pool[0]?.key,
          signal: controller.signal,
        })
        .then((previewUrl) => {
          if (controller.signal.aborted) return;
          lookups.current.delete(card.key);
          requested.current.add(card.key);
          if (!previewUrl || !mounted.current) return;
          setSamples((current) => new Map(current).set(card.key, previewUrl));
        })
        .catch(() => {
          if (!controller.signal.aborted) requested.current.add(card.key);
          lookups.current.delete(card.key);
        });
    }
  }, [catalog, deck, state]);

  // Nothing to wait for once the deck is gone.
  useEffect(
    () => () => {
      for (const controller of lookups.current.values()) controller.abort();
      lookups.current.clear();
    },
    [],
  );

  // A sample that lands after the swipe already tried to play this card (its
  // lookup was waiting out the budget) starts it now. A card the listener
  // paused stays paused, and the first card still needs its tap.
  useEffect(() => {
    const card = state.pool[0];
    if (!sound || !card) return;
    const snapshot = player.getSnapshot();
    if (snapshot.key !== card.key || snapshot.status !== 'nosample') return;
    const previewUrl = card.previewUrl ?? samples.get(card.key);
    if (previewUrl) player.play({ ...card, previewUrl });
  }, [player, samples, sound, state]);

  // Keep the following card's sample warm. The current card loads on its first tap.
  useEffect(() => {
    const upcoming = deck.prefetchQueue(state).map(withSample).find((card) => card.previewUrl);
    if (upcoming) player.preload(upcoming);
  }, [deck, player, state, withSample]);

  // Leaving the deck silences whatever was playing.
  useEffect(() => () => player.stop(), [player]);

  const react = useCallback(
    (reaction: 'like' | 'skip') => {
      const card = deck.state.pool[0];
      if (!card) return;
      const now = performance.now();
      const next = deck.commit({ card, reaction, elapsedMs: now - cardStartedAt.current });
      setState(next);
      cardStartedAt.current = now;

      // Sound on: the promoted card starts inside the swipe gesture, which is
      // what the browser's autoplay policy allows without another tap.
      const promoted = next.pool[0];
      if (sound && promoted) player.play(withSample(promoted));
      else player.stop();

      if (deck.shouldRefill()) void refill();
    },
    [deck, player, refill, sound, withSample],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || settingsOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        react('like');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        react('skip');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [react, settingsOpen]);

  const current = state.pool[0];

  if (!current) {
    if (state.status === 'stalled' || state.emptyReason === 'no-candidates') {
      return (
        <section className="screen screen--empty" aria-labelledby="discovery-title">
          <DeckNotice
            status={state.status}
            emptyReason={state.emptyReason}
            hasCards={false}
            onRetry={freshDeck}
            onChangeSeeds={() => withTransition(() => setScreen('setup'))}
          />
        </section>
      );
    }

    // A refill in flight (the deck is still 'dealing') is not the deck's end.
    if (loading || state.status === 'dealing') {
      return (
        <section className="screen screen--empty" aria-labelledby="discovery-loading-title">
          <h1 id="discovery-loading-title" className="screen__title">
            Your deck is getting ready
          </h1>
          <p className="screen__body">Finding artists near your seeds.</p>
        </section>
      );
    }

    return (
      <section className="screen screen--empty" aria-labelledby="discovery-end-title">
        <h1 id="discovery-end-title" className="screen__title">
          That&apos;s everything in this direction
        </h1>
        <p className="screen__body">
          Nothing left here clears the bar. Try again, or widen what you started from.
        </p>
        <div className="screen__actions">
          <Button variant="primary" onClick={freshDeck}>
            Fresh deck
          </Button>
          <Button variant="secondary" onClick={() => withTransition(() => setScreen('setup'))}>
            Change seeds
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen deck" aria-labelledby="discovery-title">
      <h1 id="discovery-title" className="sr-only">
        Discover
      </h1>

      <DeckNotice
        status={state.status}
        emptyReason={state.emptyReason}
        hasCards
        onRetry={freshDeck}
        onChangeSeeds={() => withTransition(() => setScreen('setup'))}
      />

      <div className="deck__stack">
        <div className="deck__current">
          <SwipeCard key={current.key} card={withSample(current)} onCommit={react} />
        </div>
        {/* Kept in the DOM (not shown) so the next cards' artwork and text are
            already loaded when a swipe promotes them. */}
        <div className="deck__upcoming" aria-hidden="true">
          {deck.prefetchQueue(state).map((card) => (
            <Card key={card.key} card={withSample(card)} />
          ))}
        </div>
      </div>

      <div className="deck__actions">
        <button
          type="button"
          className="deck-action deck-action--skip"
          aria-label="Skip"
          onClick={() => react('skip')}
        >
          <SkipIcon />
        </button>
        <button
          type="button"
          className="deck-action deck-action--like"
          aria-label="Like"
          onClick={() => react('like')}
        >
          <LikeIcon />
        </button>
      </div>

    </section>
  );
}
