import { chipLabel } from '../chips';
import type { Card as CardModel } from '../types';
import { ArtworkPlaceholder } from './icons';

/** Static recommendation card. Drag/audio behaviour arrives with the deck slice. */
export function Card({ card }: { card: CardModel }) {
  return (
    <article className="card">
      <div className="card__art">
        {card.image ? (
          <img src={card.image} alt={`${card.title} — ${card.creator}`} />
        ) : (
          <div className="card__placeholder">
            <ArtworkPlaceholder />
          </div>
        )}
        <div className="card__play-slot" aria-hidden="true" />
      </div>

      <h2 className="card__title">{card.title}</h2>
      <p className="card__creator">{card.creator}</p>

      <div className="card__meta">
        {card.year !== undefined && <span className="card__year">{card.year}</span>}
        {card.chips.slice(0, 2).map((chip) => (
          <span key={chip} className="tag">
            {chipLabel(chip)}
          </span>
        ))}
      </div>

      {card.because && <p className="card__because">Because you like {card.because}</p>}

      <p className="sr-only" aria-live="polite">
        {card.title} — {card.creator}
      </p>
    </article>
  );
}
