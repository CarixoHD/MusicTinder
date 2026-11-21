import { useDrag } from '@use-gesture/react';
import { animate, m, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Card as CardModel } from '../../types';
import { Card } from '../Card';
import { onReducedMotionChange, prefersReducedMotion } from '../motion';
import './swipe-card.css';

type SwipeReaction = 'like' | 'skip';

const SPRING = { type: 'spring', stiffness: 320, damping: 32 } as const;
const FLY_OUT_MS = 220;
const REDUCED_FADE_MS = 120;
const MAX_ROTATION = 8;
/** Share of the card width a drag must cover to commit. */
const COMMIT_WIDTH = 0.35;
/** px/ms: a quick flick commits even when the finger barely travels. */
const FLICK_VELOCITY = 0.5;
/** Horizontal travel (px) at which the like/skip label is fully faded in. */
const LABEL_TRAVEL = 72;

interface SwipeCardProps {
  card: CardModel;
  onCommit: (reaction: SwipeReaction) => void;
}

/** The deck's top card: 1:1 drag on motion values, fly-out commit, and a
 * reduced-motion path with no rotation or fling. */
export function SwipeCard({ card, onCommit }: SwipeCardProps) {
  const [isReduced, setIsReduced] = useState(prefersReducedMotion);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmed, setConfirmed] = useState<SwipeReaction | null>(null);
  const x = useMotionValue(0);
  const rotate = useMotionValue(0);
  const faceOpacity = useMotionValue(1);
  const likeOpacity = useTransform(x, [0, LABEL_TRAVEL], [0, 1]);
  const skipOpacity = useTransform(x, [-LABEL_TRAVEL, 0], [1, 0]);
  const cardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const leavingRef = useRef(false);

  // Follow the OS setting live: flipping Reduce Motion mid-session changes the
  // very next gesture.
  useEffect(() => onReducedMotionChange(setIsReduced), []);

  const commit = (reaction: SwipeReaction) => {
    leavingRef.current = true;
    const direction = reaction === 'like' ? 1 : -1;
    const width = cardRef.current?.offsetWidth ?? 320;

    if (isReduced) {
      // Reduced motion: no rotation, no fling. The on-card label confirms the
      // reaction while the card cross-fades out in 120 ms, then the deck moves on.
      setConfirmed(reaction);
      animate(faceOpacity, 0, { duration: REDUCED_FADE_MS / 1000 })
        .finished.then(() => onCommit(reaction))
        .catch(() => onCommit(reaction));
      return;
    }

    void Promise.all([
      animate(x, direction * width * 1.4, {
        duration: FLY_OUT_MS / 1000,
        ease: [0.2, 0.7, 0.3, 1],
      }).finished,
      animate(rotate, direction * MAX_ROTATION, {
        duration: FLY_OUT_MS / 1000,
        ease: [0.2, 0.7, 0.3, 1],
      }).finished,
    ]).then(
      () => onCommit(reaction),
      () => onCommit(reaction),
    );
  };

  const settleBack = () => {
    animate(x, 0, SPRING);
    animate(rotate, 0, SPRING);
  };

  useDrag(
    ({ movement: [mx], velocity: [vx], down, last }) => {
      if (leavingRef.current) return;

      if (down) {
        if (!draggingRef.current) {
          draggingRef.current = true;
          setIsDragging(true);
        }
        x.set(mx);
        rotate.set(isReduced ? 0 : Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, mx / 18)));
        return;
      }

      if (!last) return;
      draggingRef.current = false;
      setIsDragging(false);

      const width = cardRef.current?.offsetWidth ?? 320;
      const passed = Math.abs(mx) >= width * COMMIT_WIDTH || Math.abs(vx) >= FLICK_VELOCITY;
      if (passed && mx !== 0) commit(mx > 0 ? 'like' : 'skip');
      else settleBack();
    },
    {
      target: cardRef,
      axis: 'x',
      filterTaps: true,
      // Keep pointer capture off so the play button inside the card still gets
      // its click; use-gesture listens on the window for the duration.
      pointer: { capture: false },
      touchAction: 'pan-y',
    },
  );

  return (
    <m.div
      ref={cardRef}
      className={['swipe-card', isDragging ? 'swipe-card--dragging' : ''].filter(Boolean).join(' ')}
      style={{ x, rotate }}
      initial={isReduced ? false : { scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={SPRING}
    >
      <m.div className="swipe-card__face" style={{ opacity: faceOpacity }}>
        <Card card={card} />
      </m.div>
      <m.span
        className="swipe-label swipe-label--like"
        style={{ opacity: confirmed === 'like' ? 1 : likeOpacity }}
        aria-hidden="true"
      >
        Like
      </m.span>
      <m.span
        className="swipe-label swipe-label--skip"
        style={{ opacity: confirmed === 'skip' ? 1 : skipOpacity }}
        aria-hidden="true"
      >
        Skip
      </m.span>
    </m.div>
  );
}
