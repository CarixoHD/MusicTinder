import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../../catalog';
import { ITUNES_BUDGET, resetItunesBudget, withItunesBudget } from '../../catalog/budget';
import { useStore } from '../../store/store';
import { FakeCatalog } from '../../testkit/fakeCatalog';
import {
  CatalogError,
  type Catalog,
  type Chip,
  type SeedCandidate,
  type SeedSearchOptions,
} from '../../types';
import { SeedSearch } from './SeedSearch';

// Setup's search is the one place that may wait on the shared iTunes budget:
// it shows a loading row through a cool-down, asks Deezer when Apple refuses,
// and never spends a request on a term too short to mean anything.

const ARTIST_HIT: SeedCandidate = {
  itunesId: 9101,
  kind: 'artist',
  name: 'Ada Vale',
  creator: 'Ada Vale',
  image: 'https://cdn.example.test/artists/9101.jpg',
  chips: ['electronic'],
};

const ALBUM_HIT: SeedCandidate = {
  itunesId: 91011,
  kind: 'album',
  name: 'Ada Vale No. 1',
  creator: 'Ada Vale',
  year: 2019,
  chips: ['electronic'],
};

const DEEZER_HITS: SeedCandidate[] = [
  {
    deezerArtistId: 4346304,
    kind: 'artist',
    name: 'Carpenter Brut',
    creator: 'Carpenter Brut',
    image: 'https://cdn-images.dzcdn.net/artist/4346304/250x250.jpg',
    chips: ['other'],
    fans: 84_217,
  },
  {
    deezerArtistId: 414858642,
    kind: 'artist',
    name: 'Carpenter Brut',
    creator: 'Carpenter Brut',
    chips: ['other'],
    fans: 6,
  },
];

interface SearchCall {
  term: string;
  type: 'artist' | 'album';
  signal?: AbortSignal;
}

/** A catalog fixture whose search the test controls; every other method is real. */
class ScriptedCatalog extends FakeCatalog {
  readonly calls: SearchCall[] = [];
  private readonly respond: (term: string, call: number) => Promise<SeedCandidate[]>;

  constructor(respond: (term: string, call: number) => Promise<SeedCandidate[]>) {
    super();
    this.respond = respond;
  }

  override async searchSeeds(
    term: string,
    type: 'artist' | 'album',
    options: SeedSearchOptions = {},
  ): Promise<SeedCandidate[]> {
    this.calls.push({ term, type, signal: options.signal });
    return this.respond(term, this.calls.length);
  }
}

/** Holds enrichment open so the test can see the seed before chips arrive. */
class SlowEnrichCatalog extends ScriptedCatalog {
  readonly enrichment = deferred<{ itunesArtistId: number; chips: Chip[] } | null>();

  override async enrichArtist(): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    return this.enrichment.promise;
  }
}

class FailingEnrichCatalog extends ScriptedCatalog {
  override async enrichArtist(): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    throw new CatalogError('rate', 'iTunes is cooling down');
  }
}

const ADA_DEEZER_HIT: SeedCandidate = {
  deezerArtistId: 4101,
  kind: 'artist',
  name: 'Ada Vale',
  creator: 'Ada Vale',
  image: 'https://cdn.example.test/artists/4101.jpg',
  chips: ['other'],
  fans: 18_400,
};

const SEARCH = 'https://itunes.apple.com/search';

const server = setupServer();

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const observers: MutationObserver[] = [];

/** Plays the Deezer CDN: answers the real JSONP script with `reply`. */
function serveScripts(reply: () => unknown): { srcs: string[] } {
  const srcs: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        srcs.push(node.src);
        const callback = new URL(node.src).searchParams.get('callback') ?? '';
        queueMicrotask(() => {
          const handler = (window as unknown as Record<string, unknown>)[callback];
          if (typeof handler === 'function') (handler as (payload: unknown) => void)(reply());
        });
      }
    }
  });
  observer.observe(document.head, { childList: true });
  observers.push(observer);
  return { srcs };
}

let container: HTMLDivElement;
let root: Root;

const mount = async (catalog: Catalog, type: 'artist' | 'album' = 'artist') => {
  await act(async () => {
    root.render(<SeedSearch type={type} catalog={catalog} />);
  });
};

const input = (): HTMLInputElement => {
  const element = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (element === null) throw new Error('no search input rendered');
  return element;
};

const typeTerm = async (value: string): Promise<void> => {
  await act(async () => {
    // React tracks the native value: set it through the prototype setter so the
    // input event is not swallowed as a no-op.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const button = (name: RegExp): HTMLButtonElement | null =>
  [...container.querySelectorAll<HTMLButtonElement>('.seed-result')].find((element) =>
    name.test(element.textContent ?? ''),
  ) ?? null;

const status = (): string | null =>
  container.querySelector('[role="status"]')?.textContent ?? null;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  localStorage.clear();
  resetItunesBudget();
  useStore.setState({ seeds: [] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  server.resetHandlers();
  vi.useRealTimers();
  for (const observer of observers.splice(0)) observer.disconnect();
});
afterAll(() => server.close());

describe('SeedSearch', () => {
  it('searches once per ~400 ms pause and never for a term under two characters', async () => {
    const catalog = new ScriptedCatalog(async () => [ARTIST_HIT]);
    await mount(catalog);

    await typeTerm('a');
    await advance(1_000);
    expect(catalog.calls).toHaveLength(0);

    await typeTerm('ad');
    await advance(399);
    expect(catalog.calls).toHaveLength(0);

    await advance(1);
    expect(catalog.calls.map((call) => call.term)).toEqual(['ad']);

    // Several keystrokes inside one pause are one search, for the latest term.
    await typeTerm('ada');
    await typeTerm('adav');
    await advance(400);
    expect(catalog.calls.map((call) => call.term)).toEqual(['ad', 'adav']);
  });

  it('shows its loading row while the catalog waits, then the results', async () => {
    const pending = deferred<SeedCandidate[]>();
    const catalog = new ScriptedCatalog(() => pending.promise);
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    expect(status()).toContain('Searching');

    pending.resolve([ARTIST_HIT]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(button(/Ada Vale/)).not.toBeNull();
    expect(status()).toBeNull();
  });

  it('drops the previous term’s results and no-match row while the new term is pending', async () => {
    const pending = deferred<SeedCandidate[]>();
    const catalog = new ScriptedCatalog(async (term) =>
      term === 'ada' ? [ARTIST_HIT] : term === 'zzz' ? [] : pending.promise,
    );
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    expect(button(/Ada Vale/)).not.toBeNull();

    // A newer term is pending: the old hits are gone (not merely hidden behind
    // a click) and the loading row says the search is still running.
    await typeTerm('north');
    expect(button(/Ada Vale/)).toBeNull();
    expect(container.querySelectorAll('.seed-result')).toHaveLength(0);
    expect(status()).toContain('Searching');

    // The same holds for a stale "no match" row.
    await typeTerm('zzz');
    await advance(400);
    expect(container.textContent).toContain('No match for ‘zzz’');
    await typeTerm('north');
    expect(container.textContent).not.toContain('No match');
    expect(container.querySelectorAll('.seed-result')).toHaveLength(0);
    expect(status()).toContain('Searching');
  });

  it('falls back to the shared vinyl when a hit’s artwork fails to load', async () => {
    const catalog = new ScriptedCatalog(async () => [ARTIST_HIT]);
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    const thumb = button(/Ada Vale/)?.querySelector('.seed-result__thumb');
    const image = thumb?.querySelector('img');
    expect(image?.getAttribute('src')).toBe(ARTIST_HIT.image);

    await act(async () => {
      image?.dispatchEvent(new Event('error'));
    });

    expect(thumb?.querySelector('img')).toBeNull();
    expect(thumb?.querySelector('svg')).not.toBeNull();
  });

  it('a Deezer quota refusal never blames Apple and still offers Retry', async () => {
    server.use(
      http.get(SEARCH, () => new HttpResponse(null, { status: 429 })),
    );
    serveScripts(() => ({
      error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 },
    }));

    await mount(createCatalog(), 'artist');
    await typeTerm('ada');
    await advance(400);
    await advance(0);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Searches are limited',
    );
    expect(container.textContent).not.toContain('Apple');
    expect(
      [...container.querySelectorAll('button')].some((element) => element.textContent === 'Retry'),
    ).toBe(true);
  });

  it('saves a picked Deezer artist at once, then fills its chips and iTunes id from enrichment', async () => {
    const catalog = new SlowEnrichCatalog(async () => [ADA_DEEZER_HIT]);
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    button(/Ada Vale/)?.click();

    // Picking never waits on iTunes: the seed lands with chips ['other'].
    expect(useStore.getState().seeds).toMatchObject([
      { id: 'dz:artist:4101', deezerArtistId: 4101, chips: ['other'] },
    ]);
    expect(useStore.getState().seeds[0]?.itunesArtistId).toBeUndefined();

    catalog.enrichment.resolve({ itunesArtistId: 9101, chips: ['electronic', 'ambient'] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useStore.getState().seeds).toMatchObject([
      {
        id: 'dz:artist:4101',
        deezerArtistId: 4101,
        itunesArtistId: 9101,
        chips: ['electronic', 'ambient'],
      },
    ]);
  });

  it('keeps chips [other] and saves the seed anyway when enrichment fails', async () => {
    const catalog = new FailingEnrichCatalog(async () => [ADA_DEEZER_HIT]);
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    button(/Ada Vale/)?.click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useStore.getState().seeds).toMatchObject([
      { id: 'dz:artist:4101', deezerArtistId: 4101, chips: ['other'] },
    ]);
    expect(useStore.getState().seeds[0]?.itunesArtistId).toBeUndefined();
  });

  it('answers an artist search from Deezer without spending an iTunes request', async () => {
    const itunesSearches: string[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        itunesSearches.push(request.url);
        return HttpResponse.json({ resultCount: 0, results: [] });
      }),
    );
    const { srcs } = serveScripts(() => ({
      data: [{ id: 4346304, name: 'Carpenter Brut', nb_fan: 84_217 }],
    }));

    await mount(createCatalog());
    await typeTerm('carpenter brut');
    await advance(400);

    expect(button(/Carpenter Brut/)).not.toBeNull();
    expect(srcs).toHaveLength(1);
    expect(itunesSearches).toEqual([]);
  });

  it('stores a Deezer artist as a dz seed with its deezerArtistId and shows the fan count', async () => {
    const catalog = new ScriptedCatalog(async () => DEEZER_HITS);
    await mount(catalog);

    await typeTerm('carpenter brut');
    await advance(400);

    expect(container.textContent).toContain('84k fans');
    expect(container.textContent).toContain('6 fans');
    button(/Carpenter Brut/)?.click();

    expect(useStore.getState().seeds).toMatchObject([
      {
        id: 'dz:artist:4346304',
        kind: 'artist',
        name: 'Carpenter Brut',
        deezerArtistId: 4346304,
        chips: ['other'],
      },
    ]);
    expect(useStore.getState().seeds[0]?.itunesArtistId).toBeUndefined();
  });

  it('shows the rate message for a refused album search and Retry runs it again', async () => {
    const catalog = new ScriptedCatalog(async (_term, call) => {
      if (call === 1) throw new CatalogError('rate', 'iTunes rate limit reached (429)');
      return [ALBUM_HIT];
    });
    await mount(catalog, 'album');

    await typeTerm('ada');
    await advance(400);
    expect(container.textContent).toContain('Apple is limiting searches right now');

    const retry = [...container.querySelectorAll('button')].find(
      (element) => element.textContent === 'Retry',
    );
    if (retry === undefined) throw new Error('no Retry button rendered');
    await act(async () => retry.click());
    await advance(400);

    expect(button(/Ada Vale No\. 1/)).not.toBeNull();
    expect(container.textContent).not.toContain('Apple is limiting searches right now');
  });

  it('holds an album search through an empty iTunes budget and shows results after a refill', async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          resultCount: 1,
          results: [
            {
              wrapperType: 'collection',
              collectionId: 91011,
              collectionName: 'Ada Vale No. 1',
              artistName: 'Ada Vale',
              primaryGenreName: 'Electronic',
            },
          ],
        }),
      ),
    );
    for (let token = 0; token < ITUNES_BUDGET; token += 1) {
      await withItunesBudget(null, async () => null);
    }

    await mount(createCatalog(), 'album');
    await typeTerm('ada');
    await advance(400);
    expect(status()).toContain('Searching');
    expect(container.textContent).not.toContain('Apple is limiting searches');

    await advance(4_000);
    expect(button(/Ada Vale No\. 1/)).not.toBeNull();
    expect(container.textContent).not.toContain('Apple is limiting searches');
  });

  it('abandons the pending wait when the term changes', async () => {
    const catalog = new ScriptedCatalog(() => new Promise<SeedCandidate[]>(() => {}));
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    const first = catalog.calls[0];
    expect(first?.signal?.aborted).toBe(false);

    await typeTerm('north');
    expect(first?.signal?.aborted).toBe(true);

    await advance(400);
    expect(catalog.calls.map((call) => call.term)).toEqual(['ada', 'north']);
  });
});
