import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetItunesBudget } from './budget';
import { artistAlbums, artistTopTracks, enrichArtist } from './itunesLookup';

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

/** Stub the network: reply(url) returns the JSON body for that request. */
function mockFetch(reply: (url: string) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => jsonResponse(await reply(String(input))));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

const trackReply = (url: string) => {
  const id = Number(/[?&]id=(\d+)/.exec(url)?.[1] ?? 0);
  return { ...TRACK_RESPONSE, results: TRACK_RESPONSE.results.map((result) => ({ ...result, trackId: (result.trackId ?? 0) + id * 10 })) };
};

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  resetItunesBudget();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('enrichArtist', () => {
  it('searches musicArtist and returns the exact match with chips from primaryGenreName', async () => {
    const fetchMock = mockFetch(() => ({
      resultCount: 2,
      results: [
        { wrapperType: 'artist', artistId: 9, artistName: 'Ada Vale Tribute', primaryGenreName: 'Pop' },
        { wrapperType: 'artist', artistId: 42, artistName: 'Ada Vale', primaryGenreName: 'Hip-Hop/Rap' },
      ],
    }));

    await expect(enrichArtist('ada vale')).resolves.toEqual({ itunesArtistId: 42, chips: ['hip-hop'] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://itunes.apple.com/search?term=ada%20vale&media=music&entity=musicArtist&limit=5',
    );
  });

  it('returns null when no search hit carries the name', async () => {
    mockFetch(() => ({ resultCount: 1, results: [{ wrapperType: 'artist', artistId: 7, artistName: 'Someone Else' }] }));

    await expect(enrichArtist('ada vale')).resolves.toBeNull();
  });
});

describe('artistTopTracks', () => {
  it('looks up songs and maps them to Cards with 600px art, year, chips, preview and a clean Apple link', async () => {
    const fetchMock = mockFetch(() => TRACK_RESPONSE);

    const cards = await artistTopTracks(42, 2);

    expect(fetchMock.mock.calls[0][0]).toBe('https://itunes.apple.com/lookup?id=42&entity=song&limit=2');
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
    const fetchMock = mockFetch(() => ALBUM_RESPONSE);

    const cards = await artistAlbums(42, 1);

    expect(fetchMock.mock.calls[0][0]).toBe('https://itunes.apple.com/lookup?id=42&entity=album&limit=1');
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
  it('rejects with a network CatalogError when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );

    await expect(artistTopTracks(42, 2)).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });
  });

  it('rejects with a rate CatalogError when Apple answers 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 429)));

    await expect(enrichArtist('ada vale')).rejects.toMatchObject({ name: 'CatalogError', kind: 'rate' });
  });

  it('rejects with a notfound CatalogError when the lookup has no results', async () => {
    mockFetch(() => ({ resultCount: 0, results: [] }));

    await expect(artistAlbums(404, 5)).rejects.toMatchObject({ name: 'CatalogError', kind: 'notfound' });
  });
});

describe('lookup cache', () => {
  it('serves a second identical lookup within 24 h from cache with no fetch, then refetches when stale', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const fetchMock = mockFetch(() => TRACK_RESPONSE);

    const first = await artistTopTracks(42, 2);
    vi.setSystemTime(new Date('2027-01-01T23:00:00Z'));
    const second = await artistTopTracks(42, 2);

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2027-01-02T01:00:00Z'));
    await artistTopTracks(42, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('iTunes budget', () => {
  it('serialises concurrent lookups, one fetch in flight at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return jsonResponse(trackReply(String(input)));
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([artistTopTracks(1, 1), artistTopTracks(2, 1), artistTopTracks(3, 1)]);

    expect(maxInFlight).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('resolves empty without fetching once the budget is spent, and recovers after a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    resetItunesBudget();
    const fetchMock = mockFetch(trackReply);

    for (let id = 1; id <= 17; id += 1) {
      await artistTopTracks(id, 1);
    }
    expect(fetchMock).toHaveBeenCalledTimes(17);

    await expect(artistTopTracks(99, 1)).resolves.toEqual([]);
    await expect(enrichArtist('Ada Vale')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(17);

    vi.setSystemTime(new Date('2027-01-01T00:01:00Z'));
    await expect(artistTopTracks(99, 1)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(18);
  });
});
