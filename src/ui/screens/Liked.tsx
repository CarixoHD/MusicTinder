import { useState } from 'react';
import { buildLink, type MusicApp } from '../../links/links';
import { useStore } from '../../store/store';
import type { LikedItem } from '../../types';
import { Button } from '../Button';
import { ArtworkPlaceholder } from '../icons';
import { withTransition } from '../transition';
import './liked.css';

const APP_LABEL: Record<MusicApp, string> = {
  spotify: 'Spotify',
  apple: 'Apple Music',
  ytmusic: 'YouTube Music',
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
        <img
          src={item.image}
          alt={`${item.title} — ${item.creator}`}
          onError={() => setIsBroken(true)}
        />
      ) : (
        <ArtworkPlaceholder />
      )}
    </span>
  );
}

function LikedRow({ item, musicApp, index }: { item: LikedItem; musicApp: MusicApp; index: number }) {
  return (
    <li className="liked-row-item" style={{ animationDelay: `${index * 30}ms` }}>
      <a
        className="liked-row"
        href={buildLink(item, musicApp)}
        target="_blank"
        rel="noopener"
      >
        <Thumb item={item} />
        <span className="liked-row__text">
          <span className="liked-row__title">{item.title}</span>
          <span className="liked-row__creator">{item.creator}</span>
        </span>
        {item.year !== undefined && <span className="liked-row__year">{item.year}</span>}
        <ExternalLinkIcon />
        <span className="sr-only">Open in {APP_LABEL[musicApp]}</span>
      </a>
    </li>
  );
}

export default function Liked() {
  const liked = useStore((state) => state.liked);
  const musicApp = useStore((state) => state.settings.musicApp);
  const setScreen = useStore((state) => state.setScreen);

  if (liked.length === 0) {
    return (
      <section className="screen screen--empty" aria-labelledby="liked-title">
        <h1 id="liked-title" className="screen__title">
          Nothing saved yet
        </h1>
        <p className="screen__body">Swipe a few cards and your finds collect here.</p>
        <div className="screen__actions">
          <Button variant="secondary" onClick={() => withTransition(() => setScreen('discovery'))}>
            Go to Discover
          </Button>
        </div>
      </section>
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
