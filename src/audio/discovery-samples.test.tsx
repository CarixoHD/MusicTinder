import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store/store';
import { FakeCatalog, SAMPLE_TITLE } from '../testkit/fakeCatalog';
import type { Card, CardKind, Sample, SampleOptions } from '../types';
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

/** The sample line; `null` when the card shows none. */
const sampleLine = (): string | null =>
  current().querySelector('.card__sample')?.textContent ?? null;

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

/**
 * A catalog whose sample lookups stay pending, like the real one while it
 * waits out an iTunes cool-down. The test decides when each preview lands.
 */
class LateCatalog extends FakeCatalog {
  readonly sampleCalls: { key: string; priority: boolean; signal?: AbortSignal }[] = [];
  private readonly resolvers = new Map<string, (sample: Sample | undefined) => void>();

  override async samplePreview(card: Card, options: SampleOptions = {}): Promise<Sample | undefined> {
    this.sampleCalls.push({ key: card.key, priority: options.priority ?? false, signal: options.signal });
    return new Promise((resolve) => {
      this.resolvers.set(card.key, resolve);
    });
  }

  resolveSample(key: string, sample: Sample | undefined): void {
    const resolve = this.resolvers.get(key);
    if (!resolve) throw new Error(`no sample lookup pending for ${key}`);
    this.resolvers.delete(key);
    resolve(sample);
  }

  callsFor(key: string): number {
    return this.sampleCalls.filter((call) => call.key === key).length;
  }

  signalFor(key: string): AbortSignal | undefined {
    return this.sampleCalls.find((call) => call.key === key)?.signal;
  }
}

async function renderDeck(cardType: CardKind, catalog: FakeCatalog = new FakeCatalog()): Promise<void> {
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
    root.render(<Discovery catalog={catalog} />);
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
  it('names the sample song on a silent artist card and in the play button’s accessible name', async () => {
    await renderDeck('artist');

    expect(current().textContent).not.toContain('No sample');
    expect(sampleLine()).toBe(`♪ Sample: ${SAMPLE_TITLE}`);
    expect(playButton()?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);
  });

  it('turns a silent artist card into a working play button, and the next card auto-plays on like', async () => {
    await renderDeck('artist');

    const play = playButton();
    await click(play as HTMLButtonElement);
    expect(playButton()?.getAttribute('aria-label')).toBe(`Pause sample: ${SAMPLE_TITLE}`);
    const firstKey = previewPlayer().getSnapshot().key;
    expect(firstKey).not.toBeNull();

    await click(button('Like'));

    const snapshot = previewPlayer().getSnapshot();
    expect(snapshot.status).toBe('playing');
    expect(snapshot.key).not.toBe(firstKey);
    expect(playButton()?.getAttribute('aria-label')).toBe(`Pause sample: ${SAMPLE_TITLE}`);
  });

  it('turns a silent album card into a working play button named after its sample song', async () => {
    await renderDeck('album');

    expect(current().textContent).not.toContain('No sample');
    expect(sampleLine()).toBe(`♪ Sample: ${SAMPLE_TITLE}`);
    const play = playButton();
    expect(play?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);

    await click(play as HTMLButtonElement);
    expect(playButton()?.getAttribute('aria-label')).toBe(`Pause sample: ${SAMPLE_TITLE}`);
    const firstKey = previewPlayer().getSnapshot().key;

    await click(button('Like'));

    const snapshot = previewPlayer().getSnapshot();
    expect(snapshot.status).toBe('playing');
    expect(snapshot.key).not.toBe(firstKey);
    expect(playButton()?.getAttribute('aria-label')).toBe(`Pause sample: ${SAMPLE_TITLE}`);
  });

  it('shows no extra sample line on a song card, which is its own sample', async () => {
    await renderDeck('song');

    expect(sampleLine()).toBeNull();
    expect(playButton()?.getAttribute('aria-label')).toBe('Play sample');
  });

  it('gives the visible card’s lookup priority over the next card’s prefetch', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);

    expect(catalog.sampleCalls[0]).toMatchObject({ priority: true });
    expect(catalog.sampleCalls[1]).toMatchObject({ priority: false });
  });

  it('starts the promoted card when its sample lands after the swipe', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);
    expect(current().textContent).toContain('No sample');

    await click(button('Like'));
    const promoted = previewPlayer().getSnapshot();
    expect(promoted.status).toBe('nosample');
    const { key } = promoted;
    if (key === null) throw new Error('the swipe played no card');

    catalog.resolveSample(key, { previewUrl: 'https://audio.example.test/late.m4a', title: 'Late Song' });
    await flush();

    expect(previewPlayer().getSnapshot()).toMatchObject({ status: 'playing', key });
    expect(sampleLine()).toBe('♪ Sample: Late Song');
    expect(playButton()?.getAttribute('aria-label')).toBe('Pause sample: Late Song');
  });

  it('abandons the previous card’s lookup when the listener swipes on', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);
    const firstKey = catalog.sampleCalls[0].key;

    await click(button('Like'));

    expect(catalog.signalFor(firstKey)?.aborted).toBe(true);
  });

  it('asks once for a card whose lookup found no preview, and keeps the No sample state', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);
    const upcomingKey = catalog.sampleCalls[1].key;
    catalog.resolveSample(upcomingKey, undefined);
    await flush();

    await click(button('Like'));
    await flush();

    expect(current().textContent).toContain('No sample');
    expect(sampleLine()).toBeNull();
    expect(catalog.callsFor(upcomingKey)).toBe(1);
  });
});
