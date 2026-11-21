import { useEffect } from 'react';
import type { EmptyReason } from '../../deck/deck';
import type { DeckStatus } from '../../types';
import { Button } from '../Button';
import { CloudOffIcon, DiscoverIcon } from '../icons';
import { EmptyState } from './EmptyState';

interface DeckNoticeProps {
  status: DeckStatus;
  emptyReason: EmptyReason;
  /** With cards in hand the notice is one quiet row; without them it is the page. */
  hasCards: boolean;
  onRetry: () => void;
  onChangeSeeds: () => void;
}

/**
 * Story 15 in the deck: a failed refill explains itself inline and offers a
 * retry, and seeds that yield nothing say so instead of showing an empty deck.
 * Never a blocking overlay — the cards already dealt stay swipeable.
 */
export function DeckNotice({
  status,
  emptyReason,
  hasCards,
  onRetry,
  onChangeSeeds,
}: DeckNoticeProps) {
  // The deck retries by itself as soon as the browser reports the network back.
  useEffect(() => {
    if (status !== 'stalled') return;
    window.addEventListener('online', onRetry);
    return () => window.removeEventListener('online', onRetry);
  }, [status, onRetry]);

  if (status === 'stalled') {
    if (hasCards) {
      return (
        <div className="deck-notice" role="status">
          <p className="deck-notice__text">Couldn’t reach the catalog</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <EmptyState
        icon={<CloudOffIcon width={32} height={32} />}
        title="Couldn’t reach the catalog"
        body="Check your connection, then try again."
      >
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </EmptyState>
    );
  }

  if (emptyReason !== 'no-candidates') return null;

  return (
    <EmptyState
      icon={<DiscoverIcon width={32} height={32} />}
      title="Nothing to recommend from these seeds yet"
      body="Try a different artist, album or genre — the deck starts where you point it."
    >
      <Button variant="secondary" onClick={onChangeSeeds}>
        Change seeds
      </Button>
    </EmptyState>
  );
}
