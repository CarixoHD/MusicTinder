import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../store/store';
import type { LikedItem } from '../../types';
import Liked from './Liked';

const ARTIST: LikedItem = {
  key: 'dz:artist:1',
  kind: 'artist',
  title: 'Glass Harbour',
  creator: 'Glass Harbour',
  creatorKey: 'glass harbour',
  chips: ['electronic'],
};

const ALBUM: LikedItem = {
  key: 'it:album:1',
  kind: 'album',
  title: 'Discovery',
  creator: 'Daft Punk',
  creatorKey: 'daft punk',
  year: 2001,
  chips: ['electronic'],
};

const SONG: LikedItem = {
  key: 'it:song:1',
  kind: 'song',
  title: 'Digital Love',
  creator: 'Daft Punk',
  creatorKey: 'daft punk',
  chips: ['dance'],
};

let container: HTMLDivElement;
let root: Root;

type Row = { title: string; detail: string; label: string };

const rows = (): Row[] =>
  [...container.querySelectorAll('.liked-row-item')].map((row) => ({
    title: row.querySelector('.liked-row__title')?.textContent ?? '',
    detail: row.querySelector('.liked-row__creator')?.textContent ?? '',
    label: row.querySelector('.liked-row')?.getAttribute('aria-label') ?? '',
  }));

const rowFor = (title: string): Row => {
  const row = rows().find((candidate) => candidate.title === title);
  if (!row) throw new Error(`no row titled ${title}`);
  return row;
};

const mount = (liked: LikedItem[]): void => {
  useStore.setState({ liked, screen: 'liked' });
  act(() => root.render(<Liked />));
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Liked row secondary line', () => {
  it('names the creator of a liked album', () => {
    mount([ALBUM]);

    expect(rowFor('Discovery').detail).toBe('Album · Daft Punk');
    expect(rowFor('Discovery').label).toBe('Discovery, Album · Daft Punk, 2001, open in Spotify');
  });

  it('names the creator of a liked song', () => {
    mount([SONG]);

    expect(rowFor('Digital Love').detail).toBe('Song · Daft Punk');
    expect(rowFor('Digital Love').label).toBe('Digital Love, Song · Daft Punk, open in Spotify');
  });

  it('keeps an artist row at type plus genre without repeating its own name', () => {
    mount([ARTIST]);

    const row = rowFor('Glass Harbour');
    expect(row.detail).toBe('Artist · Electronic');
    expect(row.detail).not.toContain('Glass Harbour');
    expect(row.label).toBe('Glass Harbour, Artist · Electronic, open in Spotify');
  });

  it('falls back to the genre when an album has no creator', () => {
    mount([{ ...ALBUM, creator: '' }]);

    expect(rowFor('Discovery').detail).toBe('Album · Electronic');
  });
});
