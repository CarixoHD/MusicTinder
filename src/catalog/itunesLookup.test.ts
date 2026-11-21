import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types';
import { ITUNES_BUDGET, resetItunesBudget } from './budget';
import { artistAlbums, artistTopTracks, enrichArtist, samplePreview } from './itunesLookup';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

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
});

afterAll(() => server.close());

/** Serve every lookup and record the URLs the adapter actually requested. */
function serveLookups(reply: (url: string) => Record<string, unknown>): string[] {
  const urls: string[] = [];
  server.use(
    http.get(ITUNES_LOOKUP, ({ request }) => {
      urls.push(request.url);
      return HttpResponse.json(reply(request.url));
    }),
  );
  return urls;
}

const TRACK_RESPONSE = {
  resultCount: 3,
  results: [
    { wrapperType: 'artist', artistId: 42, artistName: 'Ada Vale', primaryGenreName: 'Electronic' },
    {
      wrapperType: 'track',
      kind: 'song',
      artistId: 42,
      artistName: 'Ada Vale',
      trackId: 1001,
      trackName: 'Night Bus',
      collectionId: 501,
      collectionName: 'Night Bus',
      primaryGenreName: 'Electronic',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/100x100bb.jpg',
      releaseDate: '2019-06-07T07:00:00Z',
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/abc/preview.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/night-bus/501?i=1001&uo=4',
    },
    {
      wrapperType: 'track',
      kind: 'song',
      artistId: 42,
      artistName: 'Ada Vale',
      trackId: 1002,
      trackName: 'Late Signal',
      collectionId: 501,
      primaryGenreName: 'Hip-Hop/Rap',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/100x100bb.jpg',
      releaseDate: '2020-01-01T00:00:00Z',
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/def/preview.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/night-bus/501?i=1002&uo=4',
    },
    {
      wrapperType: 'track',
      kind: 'song',
      artistId: 42,
      artistName: 'Ada Vale',
      trackId: 1003,
      trackName: 'Third',
      primaryGenreName: 'Pop',
      releaseDate: '2021-01-01T00:00:00Z',
    },
  ],
};

const ALBUM_RESPONSE = {
  resultCount: 3,
  results: [
    { wrapperType: 'artist', artistId: 42, artistName: 'Ada Vale' },
    {
      wrapperType: 'collection',
      collectionType: 'Album',
      artistId: 42,
      artistName: 'Ada Vale',
      collectionId: 501,
      collectionName: 'Night Bus',
      primaryGenreName: 'Electronic',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/100x100bb.jpg',
      releaseDate: '2019-06-07T07:00:00Z',
      collectionViewUrl: 'https://music.apple.com/us/album/night-bus/501?uo=4',
    },
    {
      wrapperType: 'collection',
      collectionType: 'Album',
      artistId: 42,
      artistName: 'Ada Vale',
      collectionId: 502,
      collectionName: 'Second Light',
      primaryGenreName: 'Ambient',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/100x100bb.jpg',
      releaseDate: '2022-03-04T00:00:00Z',
      collectionViewUrl: 'https://music.apple.com/us/album/second-light/502?uo=4',
    },
  ],
};

const lookupId = (url: string): number => Number(new URL(url).searchParams.get('id') ?? 0);

const trackReply = (url: string) => {
  const id = lookupId(url);
  return {
    ...TRACK_RESPONSE,
    results: TRACK_RESPONSE.results.map((result) => ({ ...result, trackId: (result.trackId ?? 0) + id * 10 })),
  };
};

describe('enrichArtist', () => {
  it('searches musicArtist and returns the exact match with chips from primaryGenreName', async () => {
    const urls: string[] = [];
    server.use(
      http.get(ITUNES_SEARCH, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          resultCount: 2,
          results: [
            { wrapperType: 'artist', artistId: 9, artistName: 'Ada Vale Tribute', primaryGenreName: 'Pop' },
            { wrapperType: 'artist', artistId: 42, artistName: 'Ada Vale', primaryGenreName: 'Hip-Hop/Rap' },
          ],
        });
      }),
    );

    await expect(enrichArtist('ada vale')).resolves.toEqual({ itunesArtistId: 42, chips: ['hip-hop'] });
    expect(urls[0]).toBe(
      'https://itunes.apple.com/search?term=ada%20vale&media=music&entity=musicArtist&limit=5',
    );
  });

  it('returns null when no search hit carries the name', async () => {
    server.use(
      http.get(ITUNES_SEARCH, () =>
        HttpResponse.json({
          resultCount: 1,
          results: [{ wrapperType: 'artist', artistId: 7, artistName: 'Someone Else' }],
        }),
      ),
    );

    await expect(enrichArtist('ada vale')).resolves.toBeNull();
  });
});

describe('artistTopTracks', () => {
  it('looks up songs and maps them to Cards with 600px art, year, chips, preview and a clean Apple link', async () => {
    const urls = serveLookups(() => TRACK_RESPONSE);

    const cards = await artistTopTracks(42, 2);

    expect(urls[0]).toBe('https://itunes.apple.com/lookup?id=42&entity=song&limit=2');
    expect(cards).toEqual([
      {
        key: 'it:track:1001',
        kind: 'song',
        source: 'itunes',
        title: 'Night Bus',
        creator: 'Ada Vale',
        creatorKey: 'ada vale',
        year: 2019,
        image: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/600x600bb.jpg',
        previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/abc/preview.m4a',
        appleUrl: 'https://music.apple.com/us/album/night-bus/501?i=1001',
        chips: ['electronic'],
      },
      {
        key: 'it:track:1002',
        kind: 'song',
        source: 'itunes',
        title: 'Late Signal',
        creator: 'Ada Vale',
        creatorKey: 'ada vale',
        year: 2020,
        image: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/600x600bb.jpg',
        previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/def/preview.m4a',
        appleUrl: 'https://music.apple.com/us/album/night-bus/501?i=1002',
        chips: ['hip-hop'],
      },
    ]);
  });
});

describe('artistAlbums', () => {
  it('looks up albums and maps collections to album Cards without inventing a preview', async () => {
    const urls = serveLookups(() => ALBUM_RESPONSE);

    const cards = await artistAlbums(42, 1);

    expect(urls[0]).toBe('https://itunes.apple.com/lookup?id=42&entity=album&limit=1');
    expect(cards).toEqual([
      {
        key: 'it:album:501',
        kind: 'album',
        source: 'itunes',
        title: 'Night Bus',
        creator: 'Ada Vale',
        creatorKey: 'ada vale',
        year: 2019,
        image: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/600x600bb.jpg',
        appleUrl: 'https://music.apple.com/us/album/night-bus/501',
        chips: ['electronic'],
      },
    ]);
    expect(cards[0].previewUrl).toBeUndefined();
  });

  it('strips a trailing Single/EP marker from the title and keeps it as the release type', async () => {
    serveLookups(() => ({
      resultCount: 3,
      results: [
        {
          wrapperType: 'collection',
          collectionType: 'Album',
          artistId: 42,
          artistName: 'Ada Vale',
          collectionId: 601,
          collectionName: 'Bitch - Single',
          primaryGenreName: 'Pop',
        },
        {
          wrapperType: 'collection',
          collectionType: 'Album',
          artistId: 42,
          artistName: 'Ada Vale',
          collectionId: 602,
          collectionName: 'Low Tide - EP',
          primaryGenreName: 'Indie',
        },
        {
          wrapperType: 'collection',
          collectionType: 'Album',
          artistId: 42,
          artistName: 'Ada Vale',
          collectionId: 603,
          collectionName: 'Night Bus (Deluxe)',
          primaryGenreName: 'Electronic',
        },
      ],
    }));

    const cards = await artistAlbums(42, 3);

    expect(cards.map((card) => [card.title, card.releaseType])).toEqual([
      ['Bitch', 'Single'],
      ['Low Tide', 'EP'],
      ['Night Bus (Deluxe)', undefined],
    ]);
  });
});

const cardOf = (overrides: Partial<Card> & Pick<Card, 'key' | 'kind'>): Card => ({
  source: 'itunes',
  title: 'Night Bus',
  creator: 'Ada Vale',
  creatorKey: 'ada vale',
  chips: [],
  ...overrides,
});

const albumCard = cardOf({ key: 'it:album:501', kind: 'album' });
const artistCard = cardOf({ key: 'dz:artist:5101', kind: 'artist' });

describe('samplePreview', () => {
  it('resolves an album card preview from the album song lookup', async () => {
    const urls = serveLookups(() => TRACK_RESPONSE);

    await expect(samplePreview(albumCard)).resolves.toBe(
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/abc/preview.m4a',
    );
    expect(urls[0]).toBe('https://itunes.apple.com/lookup?id=501&entity=song&limit=5');
  });

  it('resolves an artist card preview from the first hit by that artist, ignoring other artists', async () => {
    const urls: string[] = [];
    server.use(
      http.get(ITUNES_SEARCH, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          resultCount: 2,
          results: [
            { kind: 'song', artistName: 'Someone Else', previewUrl: 'https://audio.example.test/wrong.m4a' },
            { kind: 'song', artistName: 'Ada Vale', previewUrl: 'https://audio.example.test/right.m4a' },
          ],
        });
      }),
    );

    await expect(samplePreview(artistCard)).resolves.toBe('https://audio.example.test/right.m4a');
    expect(urls[0]).toBe('https://itunes.apple.com/search?term=Ada%20Vale&media=music&entity=song&limit=5');
  });

  it('serves a repeat call for the same card from cache without a second fetch', async () => {
    const urls = serveLookups(() => TRACK_RESPONSE);

    const first = await samplePreview(albumCard);
    const second = await samplePreview(albumCard);

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(urls).toHaveLength(1);
  });

  it('resolves undefined without throwing when the network fails', async () => {
    server.use(http.get(ITUNES_LOOKUP, () => HttpResponse.error()));

    await expect(samplePreview(albumCard)).resolves.toBeUndefined();
  });

  it('resolves undefined without fetching once the budget has cooled down', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(trackReply);

    for (let id = 1; id <= 17; id += 1) {
      await artistTopTracks(id, 1);
    }
    await expect(samplePreview(albumCard)).resolves.toBeUndefined();
    expect(urls).toHaveLength(17);
  });
});

describe('iTunes failures', () => {
  it('rejects with a network CatalogError when the request fails', async () => {
    server.use(http.get(ITUNES_LOOKUP, () => HttpResponse.error()));

    await expect(artistTopTracks(42, 2)).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });
  });

  it('rejects with a rate CatalogError when Apple answers 429', async () => {
    server.use(http.get(ITUNES_SEARCH, () => new HttpResponse(null, { status: 429 })));

    await expect(enrichArtist('ada vale')).rejects.toMatchObject({ name: 'CatalogError', kind: 'rate' });
  });

  it('rejects with a notfound CatalogError when the lookup has no results', async () => {
    serveLookups(() => ({ resultCount: 0, results: [] }));

    await expect(artistAlbums(404, 5)).rejects.toMatchObject({ name: 'CatalogError', kind: 'notfound' });
  });
});

describe('lookup cache', () => {
  it('serves a second identical lookup within 24 h from cache with no fetch, then refetches when stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(() => TRACK_RESPONSE);

    const first = await artistTopTracks(42, 2);
    vi.setSystemTime(new Date('2027-01-01T23:00:00Z'));
    const second = await artistTopTracks(42, 2);

    expect(second).toEqual(first);
    expect(urls).toHaveLength(1);

    vi.setSystemTime(new Date('2027-01-02T01:00:00Z'));
    await artistTopTracks(42, 2);
    expect(urls).toHaveLength(2);
  });
});

describe('iTunes budget', () => {
  it('serialises concurrent lookups, one fetch in flight at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    server.use(
      http.get(ITUNES_LOOKUP, async ({ request }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return HttpResponse.json(trackReply(request.url));
      }),
    );

    await Promise.all([artistTopTracks(1, 1), artistTopTracks(2, 1), artistTopTracks(3, 1)]);

    expect(maxInFlight).toBe(1);
  });

  it('keeps two tokens for the first cards’ samples when album enrichment spends the budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls: string[] = [];
    server.use(
      http.get(ITUNES_LOOKUP, ({ request }) => {
        urls.push(request.url);
        const entity = new URL(request.url).searchParams.get('entity');
        return HttpResponse.json(entity === 'song' ? TRACK_RESPONSE : ALBUM_RESPONSE);
      }),
    );

    // More album lookups than the budget: background enrichment stops early…
    for (let id = 1; id <= ITUNES_BUDGET - 2; id += 1) {
      await artistAlbums(id, 1);
    }
    expect(urls).toHaveLength(ITUNES_BUDGET - 2);
    // …and reports the cool-down instead of answering "no albums".
    await expect(artistAlbums(99, 1)).rejects.toMatchObject({ name: 'CatalogError', kind: 'rate' });

    // …so the current and next card's just-in-time previews still resolve.
    await expect(samplePreview(albumCard)).resolves.toBeDefined();
    await expect(samplePreview({ ...albumCard, key: 'it:album:502' })).resolves.toBeDefined();
    expect(urls).toHaveLength(ITUNES_BUDGET);
  });

  it('waits out a cool-down and resolves the visible card’s preview once a token refills', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(() => TRACK_RESPONSE);

    for (let id = 1; id <= ITUNES_BUDGET; id += 1) {
      await artistTopTracks(id, 1);
    }
    expect(urls).toHaveLength(ITUNES_BUDGET);

    let settled = false;
    const pending = samplePreview(albumCard, { waitForBudget: true, priority: true });
    void pending.then(() => {
      settled = true;
    });

    vi.advanceTimersByTime(1_000);
    expect(settled).toBe(false);

    vi.advanceTimersByTime(3_000);
    await expect(pending).resolves.toBe(
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/abc/preview.m4a',
    );
    expect(urls).toHaveLength(ITUNES_BUDGET + 1);
  });

  it('answers a genuine no-preview lookup at once and never asks again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(() => ({ resultCount: 0, results: [] }));

    await expect(samplePreview(albumCard, { waitForBudget: true, priority: true })).resolves.toBeUndefined();
    expect(urls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(urls).toHaveLength(1);
  });

  it('rejects as a rate error without fetching once the budget is spent, and recovers after a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(trackReply);

    for (let id = 1; id <= 17; id += 1) {
      await artistTopTracks(id, 1);
    }
    expect(urls).toHaveLength(17);

    // A cool-down is a failure the caller can retry, never "nothing there".
    await expect(artistTopTracks(99, 1)).rejects.toMatchObject({ name: 'CatalogError', kind: 'rate' });
    await expect(enrichArtist('Ada Vale')).rejects.toMatchObject({ name: 'CatalogError', kind: 'rate' });
    expect(urls).toHaveLength(17);

    vi.setSystemTime(new Date('2027-01-01T00:01:00Z'));
    await expect(artistTopTracks(99, 1)).resolves.toHaveLength(1);
    expect(urls).toHaveLength(18);
  });
});
