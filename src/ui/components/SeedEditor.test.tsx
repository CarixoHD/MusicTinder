import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/store';
import type { Seed } from '../../types';
import { SeedEditor } from './SeedEditor';

// The seed editor is Setup's whole picking section: the Artists|Albums search
// scope, the chosen seeds with their artwork, and the genre chips. The coming
// in-deck seeds sheet renders the same component.

const ARTIST_SEED: Seed = {
  id: 'dz:artist:4101',
  kind: 'artist',
  name: 'Ada Vale',
  deezerArtistId: 4101,
  chips: ['electronic'],
  image: 'https://cdn.example.test/artists/4101.jpg',
};

let container: HTMLDivElement;
let root: Root;

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(<SeedEditor />);
  });
};

const searchbox = (name: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);

const chip = (label: string): HTMLButtonElement => {
  const element = [...container.querySelectorAll<HTMLButtonElement>('.chip')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (element === undefined) throw new Error(`no ${label} chip`);
  return element;
};

const pill = (name: string): HTMLLIElement => {
  const element = [...container.querySelectorAll<HTMLLIElement>('.seed-pill')].find(
    (candidate) => candidate.querySelector('.seed-pill__name')?.textContent === name,
  );
  if (element === undefined) throw new Error(`no ${name} pill`);
  return element;
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({ seeds: [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('SeedEditor', () => {
  it('searches artists by default and switches to albums without touching what the deck deals', async () => {
    await mount();

    expect(searchbox('Search artists')).not.toBeNull();
    expect(searchbox('Search albums')).toBeNull();

    const albums = container.querySelector<HTMLInputElement>('input[value="album"]');
    if (albums === null) throw new Error('no Albums scope option');
    await act(async () => albums.click());

    expect(searchbox('Search albums')).not.toBeNull();
    expect(searchbox('Search artists')).toBeNull();
  });

  it('shows a chosen seed with its catalog artwork and the shared fallback when the image breaks', async () => {
    useStore.setState({ seeds: [ARTIST_SEED] });
    await mount();

    const thumb = pill('Ada Vale').querySelector('.seed-pill__thumb');
    const image = thumb?.querySelector('img');
    expect(image?.getAttribute('src')).toBe(ARTIST_SEED.image);
    expect(thumb?.querySelector('svg')).toBeNull();

    await act(async () => {
      image?.dispatchEvent(new Event('error'));
    });

    expect(thumb?.querySelector('img')).toBeNull();
    expect(thumb?.querySelector('svg')).not.toBeNull();
  });

  it('shows the fallback for a seed saved before artwork was carried', async () => {
    useStore.setState({ seeds: [{ ...ARTIST_SEED, image: undefined }] });
    await mount();

    const thumb = pill('Ada Vale').querySelector('.seed-pill__thumb');
    expect(thumb?.querySelector('img')).toBeNull();
    expect(thumb?.querySelector('svg')).not.toBeNull();
  });

  it('toggles a genre seed from its chip', async () => {
    await mount();

    const pop = chip('Pop');
    expect(pop.getAttribute('aria-pressed')).toBe('false');

    await act(async () => pop.click());
    expect(pop.getAttribute('aria-pressed')).toBe('true');
    expect(useStore.getState().seeds).toMatchObject([
      { id: 'genre:pop', kind: 'genre', name: 'Pop', chips: ['pop'] },
    ]);

    await act(async () => pop.click());
    expect(pop.getAttribute('aria-pressed')).toBe('false');
    expect(useStore.getState().seeds).toEqual([]);
  });
});
