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
  // Its genre is shown once: with a second genre the first one joins the second
  // line, otherwise the tag row carries it.
  const isArtist = card.kind === 'artist';
  const genreInSecondLine = isArtist && card.chips.length > 1;
  const secondary = isArtist
    ? [KIND_LABEL.artist, genreInSecondLine && card.chips[0] && chipLabel(card.chips[0])]
        .filter(Boolean)
        .join(' · ')
    : card.creator;
  const tags = isArtist ? card.chips.slice(genreInSecondLine ? 1 : 0) : card.chips;

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
        {tags.slice(0, 2).map((chip) => (
          <span key={chip} className="tag">
            {chipLabel(chip)}
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
