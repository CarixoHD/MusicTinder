import { useState } from 'react';
import { chipLabel } from '../../chips';
import { buildLink, type MusicApp } from '../../links/links';
import { useStore } from '../../store/store';
import type { LikedItem } from '../../types';
import { Button } from '../Button';
import { EmptyState } from '../components/EmptyState';
import { ArtworkPlaceholder, LikedIcon } from '../icons';
import { withTransition } from '../transition';
import './liked.css';

const APP_LABEL: Record<MusicApp, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  ytmusic: 'YouTube Music',
};

const KIND_LABEL: Record<LikedItem['kind'], string> = {
  artist: 'Artist',
  album: 'Album',
  song: 'Song',
};

function ExternalLinkIcon() {
  return (
    <svg
      className="liked-row__open"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      <path d="M13 5h6v6M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

/** Fixed 56 px box; a broken snapshot image falls back to the neutral vinyl. */
function Thumb({ item }: { item: LikedItem }) {
  const [isBroken, setIsBroken] = useState(false);

  return (
    <span className="liked-row__thumb">
      {item.image && !isBroken ? (
        <img src={item.image} alt="" onError={() => setIsBroken(true)} />
      ) : (
        <ArtworkPlaceholder />
      )}
    </span>
  );
}

function LikedRow({ item, musicApp, index }: { item: LikedItem; musicApp: MusicApp; index: number }) {
  // An artist's title is its own name, so name the genre instead; an album or
  // song title does not name its creator, so show that (genre only if missing).
  const genre = item.chips[0] && chipLabel(item.chips[0]);
  const detail = item.kind === 'artist' ? genre : item.creator || genre;
  const secondary = [KIND_LABEL[item.kind], detail].filter(Boolean).join(' · ');

  return (
    <li className="liked-row-item" style={{ animationDelay: `${index * 30}ms` }}>
      {/* The link is an empty overlay: its one accessible name never repeats the
          visual text, and the whole row stays the tap target. */}
      <a
        className="liked-row"
        href={buildLink(item, musicApp)}
        target="_blank"
        rel="noopener"
        aria-label={[
          item.title,
          secondary,
          item.sampleTitle,
          item.year,
          item.releaseType,
          `open in ${APP_LABEL[musicApp]}`,
        ]
          .filter((part) => part !== undefined)
          .join(', ')}
      />
      <span aria-hidden="true" className="liked-row__visual">
        <Thumb item={item} />
        <span className="liked-row__text">
          <span className="liked-row__title">{item.title}</span>
          <span className="liked-row__creator">{secondary}</span>
          {item.sampleTitle && <span className="liked-row__sample">♪ {item.sampleTitle}</span>}
        </span>
        {item.year !== undefined && <span className="liked-row__year">{item.year}</span>}
        {item.releaseType && <span className="tag">{item.releaseType}</span>}
        <ExternalLinkIcon />
      </span>
    </li>
  );
}

export default function Liked() {
  const liked = useStore((state) => state.liked);
  const musicApp = useStore((state) => state.settings.musicApp);
  const setScreen = useStore((state) => state.setScreen);
  const hasSeeds = useStore((state) => state.seeds.length > 0);

  if (liked.length === 0) {
    return (
      <EmptyState
        icon={<LikedIcon width={32} height={32} />}
        title="Nothing saved yet"
        body="Swipe a few cards and your finds collect here."
      >
        {/* Without seeds Discover opens Setup, the same landing a reset gives. */}
        <Button
          variant="secondary"
          onClick={() => withTransition(() => setScreen(hasSeeds ? 'discovery' : 'setup'))}
        >
          Go to Discover
        </Button>
      </EmptyState>
    );
  }

  return (
    <section className="screen" aria-labelledby="liked-title">
      <h1 id="liked-title" className="screen__title">
        Liked
      </h1>
      <ul className="liked-list">
        {[...liked].reverse().map((item, index) => (
          <LikedRow key={item.key} item={item} musicApp={musicApp} index={index} />
        ))}
      </ul>
    </section>
  );
}
