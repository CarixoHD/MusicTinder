import { useSyncExternalStore } from 'react';
import type { Card as CardModel } from '../types';
import { previewPlayer } from './player';
import './audio.css';

const icon = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function PlayIcon() {
  return (
    <svg {...icon}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...icon}>
      <path d="M9 5.5v13M15 5.5v13" />
    </svg>
  );
}

/** Muted waveform: the no-sample card still reads as audio, just silent. */
const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function MutedWaveIcon() {
  return (
    <svg {...icon} width={16} height={16}>
      <path d="M3 12h1.5M7 8.5v7M10.5 6v12M14 9v6M17.5 10.5v3M21 12h-1.5" />
    </svg>
  );
}

/**
 * The card's audio affordance: a 48 px glass circle in the artwork's play slot.
 * Icon, progress ring and accessible name all say the same state; the
 * no-preview card shows a visible "No sample" pill and stays swipeable.
 */
export function PlayButton({ card }: { card: CardModel }) {
  const player = previewPlayer();
  const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

  if (!card.previewUrl) {
    return (
      <span className="play-button play-button--empty">
        <MutedWaveIcon />
        <span className="play-button__label">No sample</span>
      </span>
    );
  }

  const isCurrent = snapshot.key === card.key;
  const isPlaying = isCurrent && snapshot.status === 'playing';
  const progress = isCurrent ? snapshot.progress : 0;

  // The sample names its song, so the control does too.
  const sample = card.sampleTitle ? `: ${card.sampleTitle}` : '';

  return (
    <button
      type="button"
      className="play-button"
      aria-label={isPlaying ? `Pause sample${sample}` : `Play sample${sample}`}
      aria-pressed={isPlaying}
      onClick={() => {
        if (isPlaying) {
          player.stop();
          return;
        }
        void player.unlockOnGesture();
        player.play(card);
      }}
    >
      {/* The sample's position is a 2 px ring around the circle, so it stays
          legible at the 48 px size where a short hairline disappeared. */}
      <svg
        className="play-button__ring"
        viewBox="0 0 48 48"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="play-button__ring-track" cx="24" cy="24" r={RING_RADIUS} />
        <circle
          className="play-button__ring-progress"
          cx="24"
          cy="24"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
        />
      </svg>
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
