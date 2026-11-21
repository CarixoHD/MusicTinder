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

const SEARCH = 'https://itunes.apple.com/search';

const server = setupServer();

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

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

  it('drops the previous term’s results as soon as the term changes', async () => {
    const catalog = new ScriptedCatalog(async (term) =>
      term === 'ada' ? [ARTIST_HIT] : [],
    );
    await mount(catalog);

    await typeTerm('ada');
    await advance(400);
    expect(button(/Ada Vale/)).not.toBeNull();

    await typeTerm('north');
    expect(button(/Ada Vale/)).toBeNull();
  });

  it('stores a Deezer fallback artist as a dz seed with its deezerArtistId and shows the fan count', async () => {
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

  it('holds the searching row through an empty iTunes budget and shows results after a refill', async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          resultCount: 1,
          results: [{ artistId: 9101, artistName: 'Ada Vale', primaryGenreName: 'Electronic' }],
        }),
      ),
    );
    for (let token = 0; token < ITUNES_BUDGET; token += 1) {
      await withItunesBudget(null, async () => null);
    }

    await mount(createCatalog());
    await typeTerm('ada');
    await advance(400);
    expect(status()).toContain('Searching');
    expect(container.textContent).not.toContain('Apple is limiting searches');

    await advance(4_000);
    expect(button(/Ada Vale/)).not.toBeNull();
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
