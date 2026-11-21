import { useEffect } from 'react';
import type { EmptyReason } from '../../deck/deck';
import type { CatalogErrorKind, DeckStatus } from '../../types';
import { Button } from '../Button';

interface DeckNoticeProps {
  status: DeckStatus;
  emptyReason: EmptyReason;
  failure: CatalogErrorKind | null;
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
  failure,
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
    // A budget cool-down is Apple limiting requests for a minute, not an outage.
    const title =
      failure === 'rate' ? 'Apple is limiting new finds right now' : "Couldn't reach the catalog";
    const body =
      failure === 'rate'
        ? 'This clears up in a minute. Try again shortly.'
        : 'Check your connection, then try again.';

    if (hasCards) {
      return (
        <div className="deck-notice" role="status">
          <p className="deck-notice__text">{title}</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <div className="deck-notice deck-notice--screen" role="status">
        <h1 id="discovery-title" className="screen__title">
          {title}
        </h1>
        <p className="screen__body">{body}</p>
        <div className="screen__actions">
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (emptyReason !== 'no-candidates') return null;

  return (
    <div className="deck-notice deck-notice--screen" role="status">
      <h1 id="discovery-title" className="screen__title">
        Nothing to recommend from these seeds yet
      </h1>
      <p className="screen__body">
        Try a different artist, album or genre — the deck starts where you point it.
      </p>
      <div className="screen__actions">
        <Button variant="secondary" onClick={onChangeSeeds}>
          Change seeds
        </Button>
      </div>
    </div>
  );
}
