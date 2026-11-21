import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTaste } from '../../taste/taste';
import { useStore } from '../../store/store';
import { FakeCatalog } from '../../testkit/fakeCatalog';
import type { Chip } from '../../types';
import Discovery from './Discovery';

// The deck is session state: peeking at Liked unmounts Discovery and coming
// back must not re-deal the catalog (the card in hand stays, no waiting).

const SEED = {
  id: 'seed-peek',
  kind: 'artist' as const,
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'] as Chip[],
};

let container: HTMLDivElement;
let root: Root;
let catalog: FakeCatalog;

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const currentTitle = (): string => {
  const element = container.querySelector<HTMLElement>('.deck__current .card__title');
  if (!element) throw new Error('no current card rendered');
  return element.textContent ?? '';
};

const click = (selector: string): void => {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`no ${selector} rendered`);
  act(() => button.click());
};

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(<Discovery catalog={catalog} />);
  });
};

const unmount = (): void => {
  act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  catalog = new FakeCatalog();
  useStore.setState({
    seeds: [{ ...SEED, chips: [...SEED.chips] }],
    settings: {
      musicApp: 'spotify',
      sound: false,
      theme: 'system',
      cardType: 'artist',
      wildcards: true,
    },
    taste: { chips: {}, creators: {}, origins: {} },
    liked: [],
    seen: [],
    screen: 'discovery',
    settingsOpen: false,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play');
  vi.spyOn(HTMLMediaElement.prototype, 'pause');
  vi.spyOn(HTMLMediaElement.prototype, 'load');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Discovery deck session', () => {
  it('keeps the card in hand and asks the catalog for nothing again after a peek at Liked', async () => {
    const related = vi.spyOn(catalog, 'relatedArtists');
    const enrich = vi.spyOn(catalog, 'enrichArtist');

    await mount();
    await flush();
    const title = currentTitle();
    expect(title).not.toBe('');
    const relatedCalls = related.mock.calls.length;
    const enrichCalls = enrich.mock.calls.length;
    expect(relatedCalls).toBeGreaterThan(0);

    unmount();
    await mount();

    // The same card is on screen immediately, before any refill could resolve.
    expect(currentTitle()).toBe(title);
    await flush();
    expect(currentTitle()).toBe(title);
    expect(related.mock.calls.length).toBe(relatedCalls);
    expect(enrich.mock.calls.length).toBe(enrichCalls);
  });

  it('drops the session deck and its taste when resetAll() wipes the data', async () => {
    await mount();
    await flush();
    const firstCard = currentTitle();
    click('.deck-action--like');
    click('.deck-action--like');
    await flush();
    expect(currentTitle()).not.toBe(firstCard);
    const preReset = useStore.getState().taste;
    expect(preReset).not.toEqual(initTaste([{ ...SEED, chips: [...SEED.chips] }]));

    // Delete everything, then pick the same seed again: seed ids are stable, so
    // the old deck's key would still match and resurrect its taste and seen set.
    act(() => useStore.getState().resetAll());
    act(() => useStore.getState().addSeed({ ...SEED, chips: [...SEED.chips] }));
    act(() => useStore.getState().setScreen('discovery'));
    unmount();
    await mount();
    await flush();

    expect(currentTitle()).toBe(firstCard);
    expect(useStore.getState().taste).toEqual(initTaste([{ ...SEED, chips: [...SEED.chips] }]));
    const persisted = JSON.parse(localStorage.getItem('mt:v1') ?? 'null') as {
      state: { taste: unknown };
    };
    expect(persisted.state.taste).toEqual(initTaste([{ ...SEED, chips: [...SEED.chips] }]));
  });
});
