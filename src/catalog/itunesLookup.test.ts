import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetItunesBudget } from './budget';
import { artistAlbums, artistTopTracks, enrichArtist } from './itunesLookup';

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

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
function serveLookups(reply: (url: string) => unknown): string[] {
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

  it('resolves empty without fetching once the budget is spent, and recovers after a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const urls = serveLookups(trackReply);

    for (let id = 1; id <= 17; id += 1) {
      await artistTopTracks(id, 1);
    }
    expect(urls).toHaveLength(17);

    await expect(artistTopTracks(99, 1)).resolves.toEqual([]);
    await expect(enrichArtist('Ada Vale')).resolves.toBeNull();
    expect(urls).toHaveLength(17);

    vi.setSystemTime(new Date('2027-01-01T00:01:00Z'));
    await expect(artistTopTracks(99, 1)).resolves.toHaveLength(1);
    expect(urls).toHaveLength(18);
  });
});
