import { useCallback, useEffect, useRef, useState } from 'react';
import { previewPlayer } from '../../audio/player';
import { createCatalog } from '../../catalog';
import { createDeck, type DeckState } from '../../deck/deck';
import { useStore } from '../../store/store';
import { initTaste } from '../../taste/taste';
import type { TasteWeights } from '../../types';
import { Button } from '../Button';
import { Card } from '../Card';
import './discovery.css';

const tasteIsEmpty = (taste: TasteWeights) =>
  Object.keys(taste.chips).length === 0 && Object.keys(taste.creators).length === 0;

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

export default function Discovery() {
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

  // The deck is runtime state: one per visit, built from the store snapshot on
  // entry. Leaving Discovery (fresh seeds, or Setup) builds a new one.
  const [deck] = useState(() =>
    createDeck({
      catalog: createCatalog(),
      seeds,
      cardType,
      taste: tasteIsEmpty(taste) && seeds.length > 0 ? initTaste(seeds) : taste,
      seen,
      sink: { setTaste, markSeen, addLiked },
    }),
  );
  const [state, setState] = useState<DeckState>(deck.state);
  const [loading, setLoading] = useState(true);
  const cardStartedAt = useRef(0);
  const player = previewPlayer();

  useEffect(() => {
    cardStartedAt.current = performance.now();
  }, []);

  const refill = useCallback(() => {
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
    if (tasteIsEmpty(taste) && seeds.length > 0) setTaste(deck.state.taste);
  }, [deck, seeds.length, setTaste, taste]);

  useEffect(() => {
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

  // Keep the following card's sample warm. The current card loads on its first tap.
  useEffect(() => {
    const upcoming = deck.prefetchQueue(state).find((card) => card.previewUrl);
    if (upcoming) player.preload(upcoming);
  }, [deck, player, state]);

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
      if (sound && promoted) player.play(promoted);
      else player.stop();

      if (deck.shouldRefill()) void refill();
    },
    [deck, player, refill, sound],
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
    if (loading && state.status !== 'stalled') {
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
          <Button variant="secondary" onClick={() => setScreen('setup')}>
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

      <div className="deck__stack">
        <div className="deck__current">
          <Card key={current.key} card={current} />
        </div>
        {/* Kept in the DOM (not shown) so the next cards' artwork and text are
            already loaded when a swipe promotes them. */}
        <div className="deck__upcoming" aria-hidden="true">
          {deck.prefetchQueue(state).map((card) => (
            <Card key={card.key} card={card} />
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
