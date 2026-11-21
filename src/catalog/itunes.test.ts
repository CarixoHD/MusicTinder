import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogError } from '../types';
import { ITUNES_BUDGET, resetItunesBudget, withItunesBudget } from './budget';
import { searchSeeds } from './itunes';

const ARTWORK_100 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg';
const ARTWORK_600 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';
const SEARCH = 'https://itunes.apple.com/search';

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

const ONE_TOKEN_MS = Math.ceil(60_000 / ITUNES_BUDGET) + 100;

/** Spend the bucket down to nothing, so the next search must wait. */
async function coolDown(): Promise<void> {
  for (let token = 0; token < ITUNES_BUDGET; token += 1) {
    await withItunesBudget(null, async () => null);
  }
}

let requested: URL | null = null;

/** Answers the real search URL with fixture JSON, recording what was asked. */
const searchAnswers = (body: Record<string, unknown>) =>
  http.get(SEARCH, ({ request }) => {
    requested = new URL(request.url);
    return HttpResponse.json(body);
  });

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  resetItunesBudget();
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  requested = null;
  for (const observer of observers.splice(0)) observer.disconnect();
});
afterAll(() => server.close());

describe('searchSeeds', () => {
  it('asks iTunes for up to 8 matching artists', async () => {
    server.use(searchAnswers({ resultCount: 0, results: [] }));

    await searchSeeds('  Ada Vale ', 'artist');

    const url = requested;
    if (url === null) throw new Error('search was never requested');
    expect(`${url.origin}${url.pathname}`).toBe(SEARCH);
    expect(url.searchParams.get('term')).toBe('Ada Vale');
    expect(url.searchParams.get('media')).toBe('music');
    expect(url.searchParams.get('entity')).toBe('musicArtist');
    expect(url.searchParams.get('limit')).toBe('8');
  });

  it('asks iTunes for albums when the type is album', async () => {
    server.use(searchAnswers({ resultCount: 0, results: [] }));

    await searchSeeds('ada', 'album');

    expect(requested?.searchParams.get('entity')).toBe('album');
  });

  it('maps an artist result onto a seed candidate with its chips', async () => {
    server.use(
      searchAnswers({
        resultCount: 1,
        results: [
          {
            wrapperType: 'artist',
            artistType: 'Artist',
            artistId: 9101,
            artistName: 'Ada Vale',
            primaryGenreName: 'Electronic',
          },
        ],
      }),
    );

    const candidates = await searchSeeds('ada', 'artist');

    expect(candidates).toEqual([
      {
        itunesId: 9101,
        kind: 'artist',
        name: 'Ada Vale',
        creator: 'Ada Vale',
        chips: ['electronic'],
      },
    ]);
  });

  it('maps an album result onto a seed candidate with year, creator and upscaled artwork', async () => {
    server.use(
      searchAnswers({
        resultCount: 1,
        results: [
          {
            wrapperType: 'collection',
            collectionType: 'Album',
            collectionId: 91011,
            collectionName: 'Ada Vale No. 1',
            artistId: 9101,
            artistName: 'Ada Vale',
            primaryGenreName: 'Indie Rock',
            releaseDate: '2019-05-01T00:00:00Z',
            artworkUrl100: ARTWORK_100,
          },
        ],
      }),
    );

    const candidates = await searchSeeds('ada', 'album');

    expect(candidates).toEqual([
      {
        itunesId: 91011,
        kind: 'album',
        name: 'Ada Vale No. 1',
        creator: 'Ada Vale',
        year: 2019,
        image: ARTWORK_600,
        chips: ['indie'],
      },
    ]);
  });

  it('skips results that are not usable seed candidates', async () => {
    server.use(
      searchAnswers({
        resultCount: 2,
        results: [
          { wrapperType: 'artist', artistName: 'No id here' },
          { artistId: 7, artistName: 'Real One' },
        ],
      }),
    );

    const candidates = await searchSeeds('x', 'artist');

    expect(candidates.map((candidate) => candidate.name)).toEqual(['Real One']);
  });

  it('rejects with a network CatalogError when the request fails', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.error()));

    const failure = searchSeeds('ada', 'artist');

    await expect(failure).rejects.toBeInstanceOf(CatalogError);
    await expect(failure).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });
  });

  it('rejects with a network CatalogError when iTunes answers with an error status', async () => {
    server.use(http.get(SEARCH, () => HttpResponse.text('busy', { status: 503 })));

    await expect(searchSeeds('ada', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'network',
    });
  });

  it('rejects with a rate CatalogError when Apple answers 403 or 429', async () => {
    server.use(http.get(SEARCH, () => new HttpResponse(null, { status: 429 })));
    await expect(searchSeeds('ada', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'rate',
    });

    server.use(http.get(SEARCH, () => new HttpResponse(null, { status: 403 })));
    await expect(searchSeeds('north', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'rate',
    });
  });

  it('serves a repeated search from the 24 h cache without another request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const urls: string[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          resultCount: 1,
          results: [{ artistId: 7, artistName: 'Real One' }],
        });
      }),
    );

    const first = await searchSeeds('ada', 'artist');
    vi.setSystemTime(new Date('2027-01-01T23:00:00Z'));
    const second = await searchSeeds('ada', 'artist');

    expect(second).toEqual(first);
    expect(urls).toHaveLength(1);

    vi.setSystemTime(new Date('2027-01-02T01:00:00Z'));
    await searchSeeds('ada', 'artist');
    expect(urls).toHaveLength(2);
  });

  it('spends the shared iTunes budget and rejects as rate while it cools down', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const urls: string[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ resultCount: 0, results: [] });
      }),
    );

    for (let token = 0; token < ITUNES_BUDGET; token += 1) {
      await withItunesBudget(null, async () => null);
    }

    await expect(searchSeeds('ada', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'rate',
    });
    expect(urls).toHaveLength(0);
  });

  it('waits for the next refill when Setup passes { wait: true } instead of failing fast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const urls: string[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          resultCount: 1,
          results: [{ artistId: 7, artistName: 'Real One' }],
        });
      }),
    );
    await coolDown();

    const pending = searchSeeds('ada', 'artist', { wait: true });
    await vi.advanceTimersByTimeAsync(ONE_TOKEN_MS - 150);
    expect(urls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toMatchObject([{ itunesId: 7 }]);
    expect(urls).toHaveLength(1);
  });

  it('abandons a waiting Setup search when the term changes, asking neither catalog', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    server.use(searchAnswers({ resultCount: 0, results: [] }));
    const { srcs } = serveScripts(() => ({ data: [] }));
    await coolDown();
    const controller = new AbortController();

    const pending = searchSeeds('ada', 'artist', { wait: true, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'rate' });
    controller.abort();
    await assertion;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(requested).toBeNull();
    expect(srcs).toHaveLength(0);
  });

  it('falls back to Deezer for an artist search Apple refuses, keeping fan counts', async () => {
    server.use(http.get(SEARCH, () => new HttpResponse(null, { status: 429 })));
    const { srcs } = serveScripts(() => ({
      data: [
        {
          id: 4346304,
          name: 'Carpenter Brut',
          picture_medium: 'https://cdn-images.dzcdn.net/artist/4346304/250x250.jpg',
          nb_fan: 84_217,
        },
        { id: 414858642, name: 'Carpenter Brut', nb_fan: 6 },
      ],
    }));

    const candidates = await searchSeeds('Carpenter Brut', 'artist', { wait: true });

    expect(srcs[0]).toContain('/search/artist?q=Carpenter%20Brut');
    expect(candidates).toEqual([
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
        image: undefined,
        chips: ['other'],
        fans: 6,
      },
    ]);
  });

  it('keeps album searches fail-fast: a refused request shows the rate error, no Deezer call', async () => {
    server.use(http.get(SEARCH, () => new HttpResponse(null, { status: 429 })));
    const { srcs } = serveScripts(() => ({ data: [{ id: 1, name: 'Ada Vale' }] }));

    await expect(searchSeeds('ada', 'album', { wait: true })).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'rate',
    });
    expect(srcs).toHaveLength(0);
  });
});
