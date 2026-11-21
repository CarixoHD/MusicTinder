import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store/store';
import { FakeCatalog, SAMPLE_TITLE } from '../testkit/fakeCatalog';
import { CatalogError, type Card, type CardKind, type Sample, type SampleOptions } from '../types';
import Discovery from '../ui/screens/Discovery';
import { previewPlayer } from './player';

// Discovery with the FakeCatalog: artist and album cards start silent, the
// catalog resolves a preview just in time, and the real player consumes it.
// Media spies only observe; jsdom has no playback engine.

const SOUND_ON = { musicApp: 'spotify', sound: true, theme: 'system' } as const;

let container: HTMLDivElement;
let root: Root;

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const flush = async (): Promise<void> => {
  if (vi.isFakeTimers()) {
    await advance(0);
    return;
  }
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

/** jsdom has no media engine: raise the error a dead preview URL would. */
const failPlayback = async (): Promise<void> => {
  await act(async () => {
    for (const audio of document.querySelectorAll('audio')) {
      audio.dispatchEvent(new Event('error'));
    }
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

/** A Deezer-style catalog: each lookup signs a fresh, short-lived URL. */
class ExpiringCatalog extends FakeCatalog {
  readonly calls: { key: string; url: string }[] = [];
  private issued = 0;

  override async samplePreview(card: Card): Promise<Sample | undefined> {
    this.issued += 1;
    const url = `https://cdnt-preview.dzcdn.net/api/1/sample-${this.issued}.mp3`;
    this.calls.push({ key: card.key, url });
    return { previewUrl: url, title: SAMPLE_TITLE };
  }

  urlsFor(key: string): string[] {
    return this.calls.filter((call) => call.key === key).map((call) => call.url);
  }
}

/** Every song card is silent, and its lookup stays pending until the test says. */
class SilentSongCatalog extends LateCatalog {
  override async artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
    return (await super.artistTopTracks(itunesArtistId, limit)).map((card) => ({
      ...card,
      previewUrl: undefined,
    }));
  }
}

/** A catalog whose first lookup fails when the test says, like a short blip. */
class ManualBlipCatalog extends FakeCatalog {
  readonly calls: string[] = [];
  alwaysFail = false;
  private first = true;
  private rejecter: (() => void) | null = null;

  override async samplePreview(card: Card): Promise<Sample | undefined> {
    this.calls.push(card.key);
    if (this.first) {
      this.first = false;
      return new Promise((_, reject) => {
        this.rejecter = () => reject(new CatalogError('network'));
      });
    }
    if (this.alwaysFail) throw new CatalogError('network');
    return super.samplePreview(card);
  }

  blip(): void {
    if (!this.rejecter) throw new Error('no sample lookup is pending');
    this.rejecter();
  }

  callsFor(key: string): number {
    return this.calls.filter((call) => call === key).length;
  }
}

/** A catalog whose lookups fail once, like a transient network error. */
class FlakyCatalog extends FakeCatalog {
  readonly calls: string[] = [];
  fail = true;

  override async samplePreview(card: Card): Promise<Sample | undefined> {
    this.calls.push(card.key);
    if (this.fail) throw new CatalogError('network');
    return super.samplePreview(card);
  }

  callsFor(key: string): number {
    return this.calls.filter((call) => call === key).length;
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
    settings: { ...SOUND_ON, cardType, wildcards: true },
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
  vi.useRealTimers();
  act(() => root.unmount());
  vi.useRealTimers();
  previewPlayer().stop();
  // Keep the player's two buffers in the body: the singleton outlives a test,
  // and a later test raises its media 'error' event to fake an expired URL.
  container.remove();
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

  it('shows a loading state, not No sample, while the current card’s lookup is pending', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);

    expect(current().textContent).toContain('Finding sample');
    expect(current().textContent).not.toContain('No sample');
    expect(playButton()).toBeNull();

    const key = catalog.sampleCalls[0].key;
    catalog.resolveSample(key, { previewUrl: 'https://audio.example.test/late.m4a', title: 'Late Song' });
    await flush();

    expect(current().textContent).not.toContain('Finding sample');
    expect(playButton()?.getAttribute('aria-label')).toBe('Play sample: Late Song');
  });

  it('shows No sample only once a lookup has answered with no match', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.sampleCalls[0].key;

    catalog.resolveSample(key, undefined);
    await flush();

    expect(current().textContent).toContain('No sample');
    expect(current().textContent).not.toContain('Finding sample');
    expect(catalog.callsFor(key)).toBe(1);
  });

  it('keeps a failed lookup retryable and asks again when the network returns', async () => {
    const catalog = new FlakyCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0];

    expect(catalog.callsFor(key)).toBe(1);
    expect(current().textContent).toContain('Finding sample');
    expect(current().textContent).not.toContain('No sample');

    catalog.fail = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await flush();

    expect(catalog.callsFor(key)).toBe(2);
    expect(current().textContent).not.toContain('Finding sample');
    expect(playButton()?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);
  });

  it('asks a failed lookup again on its own, without waiting for the online event', async () => {
    const catalog = new ManualBlipCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0];
    expect(current().textContent).toContain('Finding sample');

    vi.useFakeTimers();
    try {
      await act(async () => {
        catalog.blip();
        await Promise.resolve();
      });
      expect(current().textContent).toContain('Finding sample');

      // The backoff timer asks again; the catalog answers this time.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(catalog.callsFor(key)).toBe(2);
      expect(current().textContent).not.toContain('Finding sample');
      expect(playButton()?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles on No sample after repeated failures instead of loading forever', async () => {
    const catalog = new ManualBlipCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0];

    vi.useFakeTimers();
    try {
      catalog.alwaysFail = true;
      await act(async () => {
        catalog.blip();
        await Promise.resolve();
      });

      // Every retry fails too: after the last backoff the card stops loading.
      for (const delay of [1000, 2000, 4000, 8000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delay);
        });
      }

      expect(catalog.callsFor(key)).toBeGreaterThan(1);
      expect(current().textContent).toContain('No sample');
      expect(current().textContent).not.toContain('Finding sample');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks a given-up lookup again when the network returns', async () => {
    vi.useFakeTimers();
    const catalog = new FlakyCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0];

    for (const delay of [1_000, 2_000, 4_000, 8_000]) await advance(delay);
    expect(current().textContent).toContain('No sample');
    expect(catalog.callsFor(key)).toBe(5);

    catalog.fail = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await flush();
    await flush();

    expect(catalog.callsFor(key)).toBe(6);
    expect(current().textContent).not.toContain('No sample');
    expect(playButton()?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);
  });

  it('starts the promoted card when its sample lands after the swipe', async () => {
    const catalog = new LateCatalog();
    await renderDeck('artist', catalog);
    expect(current().textContent).toContain('Finding sample');

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

  it('looks an expired sample up once more and retries playback with the fresh URL', async () => {
    const catalog = new ExpiringCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0].key;

    await click(playButton() as HTMLButtonElement);
    expect(previewPlayer().getSnapshot()).toMatchObject({ status: 'playing', key });

    await failPlayback();
    await flush();

    // A signed Deezer URL died: one fresh lookup, and the new URL plays.
    const urls = catalog.urlsFor(key);
    expect(urls).toHaveLength(2);
    expect(previewPlayer().getSnapshot()).toMatchObject({ status: 'playing', key });
    const sources = [...document.querySelectorAll('audio')].map((audio) => audio.getAttribute('src'));
    expect(sources).toContain(urls[1]);
  });

  it('shows Finding sample on a silent song card, and No sample only once the lookup misses', async () => {
    const catalog = new SilentSongCatalog();
    await renderDeck('song', catalog);

    expect(current().textContent).toContain('Finding sample');
    expect(current().textContent).not.toContain('No sample');

    const key = catalog.sampleCalls[0].key;
    catalog.resolveSample(key, undefined);
    await flush();

    expect(current().textContent).toContain('No sample');
    expect(current().textContent).not.toContain('Finding sample');
    expect(catalog.callsFor(key)).toBe(1);
  });

  it('gives up after one retry and reads No sample when the fresh sample fails too', async () => {
    const catalog = new ExpiringCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0].key;

    await click(playButton() as HTMLButtonElement);
    await failPlayback();
    await flush();
    expect(catalog.urlsFor(key)).toHaveLength(2);

    await failPlayback();
    await flush();

    expect(current().textContent).toContain('No sample');
    expect(current().textContent).not.toContain('Finding sample');
    expect(playButton()).toBeNull();
    expect(catalog.urlsFor(key)).toHaveLength(2);
  });

  it('never persists a Deezer sample URL through a like', async () => {
    const catalog = new ExpiringCatalog();
    await renderDeck('artist', catalog);
    const key = catalog.calls[0].key;
    // The Deezer URL is in memory and on the card when the like happens.
    expect(playButton()?.getAttribute('aria-label')).toBe(`Play sample: ${SAMPLE_TITLE}`);

    await click(button('Like'));
    await flush();

    const liked = useStore.getState().liked.find((item) => item.key === key);
    expect(liked).toBeDefined();
    expect(liked?.previewUrl).toBeUndefined();
    expect(JSON.stringify(useStore.getState())).not.toContain('cdnt-preview.dzcdn.net');
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index) ?? '';
      expect(localStorage.getItem(storageKey)).not.toContain('cdnt-preview.dzcdn.net');
    }
  });
});
