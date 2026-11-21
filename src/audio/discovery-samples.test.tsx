import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store/store';
import { FakeCatalog } from '../testkit/fakeCatalog';
import type { CardKind } from '../types';
import Discovery from '../ui/screens/Discovery';
import { previewPlayer } from './player';

// Discovery with the FakeCatalog: artist and album cards start silent, the
// catalog resolves a preview just in time, and the real player consumes it.
// Media spies only observe; jsdom has no playback engine.

const SOUND_ON = { musicApp: 'spotify', sound: true, theme: 'system' } as const;

let container: HTMLDivElement;
let root: Root;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const current = (): HTMLElement => {
  const element = container.querySelector<HTMLElement>('.deck__current');
  if (!element) throw new Error('no current card rendered');
  return element;
};

const playButton = (): HTMLButtonElement | null => current().querySelector('button.play-button');

const button = (label: string): HTMLButtonElement => {
  const element = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!element) throw new Error(`no button labelled ${label}`);
  return element;
};

const click = async (element: HTMLButtonElement): Promise<void> => {
  await act(async () => {
    element.click();
  });
};

async function renderDeck(cardType: CardKind): Promise<void> {
  useStore.setState({
    seeds: [
      {
        id: 'seed-ada',
        kind: 'artist',
        name: 'Ada Vale',
        creatorKey: 'ada vale',
        itunesArtistId: 9101,
        deezerArtistId: 4101,
        chips: ['electronic', 'ambient'],
      },
    ],
    settings: { ...SOUND_ON, cardType },
    taste: { chips: {}, creators: {}, origins: {} },
    liked: [],
    seen: [],
    screen: 'discovery',
    settingsOpen: false,
  });

  await act(async () => {
    root.render(<Discovery catalog={new FakeCatalog()} />);
  });
  await flush();
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(HTMLMediaElement.prototype, 'play');
  vi.spyOn(HTMLMediaElement.prototype, 'pause');
  vi.spyOn(HTMLMediaElement.prototype, 'load');
});

afterEach(() => {
  act(() => root.unmount());
  previewPlayer().stop();
  document.body.innerHTML = '';
});

describe('Discovery sample previews', () => {
  it('turns a silent artist card into a working play button, and the next card auto-plays on like', async () => {
    await renderDeck('artist');

    expect(current().textContent).not.toContain('No sample');
    const play = playButton();
    expect(play?.getAttribute('aria-label')).toBe('Play sample');

    await click(play as HTMLButtonElement);
    expect(playButton()?.getAttribute('aria-label')).toBe('Pause sample');
    const firstKey = previewPlayer().getSnapshot().key;
    expect(firstKey).not.toBeNull();

    await click(button('Like'));

    const snapshot = previewPlayer().getSnapshot();
    expect(snapshot.status).toBe('playing');
    expect(snapshot.key).not.toBe(firstKey);
    expect(playButton()?.getAttribute('aria-label')).toBe('Pause sample');
  });

  it('turns a silent album card into a working play button, and the next card auto-plays on like', async () => {
    await renderDeck('album');

    expect(current().textContent).not.toContain('No sample');
    const play = playButton();
    expect(play?.getAttribute('aria-label')).toBe('Play sample');

    await click(play as HTMLButtonElement);
    expect(playButton()?.getAttribute('aria-label')).toBe('Pause sample');
    const firstKey = previewPlayer().getSnapshot().key;

    await click(button('Like'));

    const snapshot = previewPlayer().getSnapshot();
    expect(snapshot.status).toBe('playing');
    expect(snapshot.key).not.toBe(firstKey);
    expect(playButton()?.getAttribute('aria-label')).toBe('Pause sample');
  });
});
