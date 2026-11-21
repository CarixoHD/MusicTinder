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
function MutedWaveIcon() {
  return (
    <svg {...icon} width={16} height={16}>
      <path d="M3 12h1.5M7 8.5v7M10.5 6v12M14 9v6M17.5 10.5v3M21 12h-1.5" />
    </svg>
  );
}

/**
 * The card's audio affordance: a 48 px glass circle in the artwork's play slot.
 * Icon, hairline progress and accessible name all say the same state; the
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

  return (
    <button
      type="button"
      className="play-button"
      aria-label={isPlaying ? 'Pause sample' : 'Play sample'}
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
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
      <span className="play-button__track" aria-hidden="true">
        <span
          className="play-button__progress"
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
    </button>
  );
}
