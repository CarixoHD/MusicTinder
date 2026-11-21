import { PlayButton } from '../audio/PlayButton';
import { chipLabel } from '../chips';
import type { Card as CardModel } from '../types';
import { ArtworkPlaceholder } from './icons';

const KIND_LABEL: Record<CardModel['kind'], string> = {
  artist: 'Artist',
  album: 'Album',
  song: 'Song',
};

/** Long titles need the smaller step and the second line; short ones stay display. */
const LONG_TITLE = 18;

/** Recommendation card: a surface, artwork, facts, and the sample control. */
export function Card({ card }: { card: CardModel }) {
  // An artist's name is already the title; the second line carries what it is.
  // The tag row adds the second genre, or the album count when the artist has
  // just one genre, so the genre is never printed twice. A catalog that reports
  // no album count falls back to the genre tag rather than an empty row.
  const isArtist = card.kind === 'artist';
  const secondary = isArtist
    ? [KIND_LABEL.artist, card.chips[0] && chipLabel(card.chips[0])].filter(Boolean).join(' · ')
    : card.creator;
  const artistTags = (): string[] => {
    if (card.chips.length > 1) return card.chips.slice(1, 3).map(chipLabel);
    if (card.albumCount !== undefined) {
      return [`${card.albumCount} album${card.albumCount === 1 ? '' : 's'}`];
    }
    return card.chips.slice(0, 1).map(chipLabel);
  };
  const tags = isArtist ? artistTags() : card.chips.slice(0, 2).map(chipLabel);

  // Spoken once: an artist's creator is the artist again.
  const spoken = card.kind === 'artist' ? card.title : `${card.title} — ${card.creator}`;

  return (
    <article className="card">
      <div className="card__art">
        {card.image ? (
          <img src={card.image} alt={spoken} />
        ) : (
          <div className="card__placeholder">
            <ArtworkPlaceholder />
          </div>
        )}
        <div className="card__play-slot">
          <PlayButton card={card} />
        </div>
      </div>

      <h2 className={`card__title${card.title.length > LONG_TITLE ? ' card__title--long' : ''}`}>
        {card.title}
      </h2>
      <p className="card__creator">{secondary}</p>

      <div className="card__meta">
        {card.year !== undefined && <span className="card__year">{card.year}</span>}
        {card.releaseType && <span className="tag">{card.releaseType}</span>}
        {tags.map((label) => (
          <span key={label} className="tag">
            {label}
          </span>
        ))}
      </div>

      {card.because && <p className="card__because">Because you like {card.because}</p>}

      <p className="sr-only" aria-live="polite">
        {spoken}
      </p>
    </article>
  );
}
