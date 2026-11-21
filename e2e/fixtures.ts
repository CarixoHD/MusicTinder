import type { Page } from '@playwright/test';

// Network-layer fixtures for the two catalog transports. Tests never hit the
// live catalog: iTunes is JSON over fetch, Deezer is JSONP served as a script
// body that wraps the payload in the requested `callback` name.

interface Anchor {
  name: string;
  itunesId: number;
  deezerId: number;
  genre: string;
  related: readonly (readonly [name: string, deezerId: number])[];
}

const ANCHORS: readonly Anchor[] = [
  {
    name: 'Ada Vale',
    itunesId: 9101,
    deezerId: 4101,
    genre: 'Electronic',
    related: [
      ['Glass Harbour', 5101],
      ['Slow Machines', 5102],
      ['Neon Field', 5103],
      ['Paper Satellites', 5104],
      ['Wire Assembly', 5105],
      ['Tidal Rooms', 5106],
      ['Low Atlas', 5107],
      ['Mira Chase', 5108],
    ],
  },
  {
    name: 'North Static',
    itunesId: 9102,
    deezerId: 4102,
    genre: 'Indie Rock',
    related: [
      ['Fever Orchard', 5201],
      ['Salt Lines', 5202],
      ['Static Bloom', 5203],
      ['The Quiet Hours', 5204],
      ['Copper Kites', 5205],
      ['Hollow Pines', 5206],
      ['Marble Youth', 5207],
      ['Second Coast', 5208],
    ],
  },
  {
    name: 'Lumen Choir',
    itunesId: 9103,
    deezerId: 4103,
    genre: 'R&B/Soul',
    related: [
      ['Velvet Ledger', 5301],
      ['Sunday Grammar', 5302],
      ['Nia Bloom', 5303],
      ['Basement Gold', 5304],
      ['Quiet Engine', 5305],
      ['Ana Reed', 5306],
      ['Blue Sunday', 5307],
      ['Lagos Line', 5308],
    ],
  },
];

const artwork = (seed: string | number) => `https://cdn.example.test/art/${seed}.jpg`;

const artistResult = (anchor: Anchor) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: anchor.itunesId,
  artistName: anchor.name,
  primaryGenreName: anchor.genre,
  artistLinkUrl: `https://music.apple.com/artist/${anchor.itunesId}`,
});

const albumResult = (anchor: Anchor, n: number) => ({
  wrapperType: 'collection',
  collectionType: 'Album',
  collectionId: anchor.itunesId * 10 + n,
  collectionName: `${anchor.name} No. ${n}`,
  artistId: anchor.itunesId,
  artistName: anchor.name,
  primaryGenreName: anchor.genre,
  releaseDate: `${2018 + n}-01-01T00:00:00Z`,
  artworkUrl100: artwork(`${anchor.itunesId}${n}`),
  collectionViewUrl: `https://music.apple.com/album/${anchor.itunesId * 10 + n}`,
});

const songResult = (anchor: Anchor, n: number) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: anchor.itunesId * 100 + n,
  trackName: `${anchor.name} song ${n}`,
  artistId: anchor.itunesId,
  artistName: anchor.name,
  collectionId: anchor.itunesId * 10 + 1,
  collectionName: `${anchor.name} No. 1`,
  primaryGenreName: anchor.genre,
  releaseDate: `${2020 + n}-01-01T00:00:00Z`,
  artworkUrl100: artwork(`${anchor.itunesId}${n}`),
  // Every third track has no preview: the deck must handle "no sample" cards.
  previewUrl:
    n === 3 ? undefined : `https://audio.example.test/${anchor.itunesId}${n}.m4a`,
  trackViewUrl: `https://music.apple.com/album/${anchor.itunesId * 10 + 1}?i=${anchor.itunesId * 100 + n}`,
});

function itunesSearch(params: URLSearchParams): unknown {
  const term = (params.get('term') ?? '').toLowerCase();
  const matched = ANCHORS.filter((anchor) => anchor.name.toLowerCase().includes(term));
  const results =
    params.get('entity') === 'album'
      ? matched.map((anchor) => albumResult(anchor, 1))
      : matched.map(artistResult);
  return { resultCount: results.length, results };
}

function itunesLookup(params: URLSearchParams): unknown {
  const ids = (params.get('id') ?? '')
    .split(',')
    .map(Number)
    .filter((id) => Number.isFinite(id));
  const anchors = ANCHORS.filter((anchor) => ids.includes(anchor.itunesId));
  const entity = params.get('entity') ?? 'song';

  if (entity === 'song') {
    const results = anchors.flatMap((anchor) => [1, 2, 3, 4].map((n) => songResult(anchor, n)));
    return { resultCount: results.length, results };
  }

  if (entity === 'album') {
    const results = anchors.flatMap((anchor) => [1, 2, 3].map((n) => albumResult(anchor, n)));
    return { resultCount: results.length, results };
  }

  const results = anchors.map(artistResult);
  return { resultCount: results.length, results };
}

function deezerSearch(params: URLSearchParams): unknown {
  const term = (params.get('q') ?? '').toLowerCase();
  return {
    data: ANCHORS.filter((anchor) => anchor.name.toLowerCase().includes(term)).map((anchor) => ({
      id: anchor.deezerId,
      name: anchor.name,
      picture_medium: artwork(anchor.itunesId),
      picture_big: artwork(anchor.itunesId),
    })),
  };
}

function deezerRelated(deezerArtistId: number): unknown {
  const anchor = ANCHORS.find((item) => item.deezerId === deezerArtistId);
  if (!anchor) return { data: [] };
  return {
    data: anchor.related.map(([name, id]) => ({
      id,
      name,
      picture_medium: artwork(id),
      picture_big: artwork(id),
    })),
  };
}

// Related artists reachable from a seed anchor only become album/song cards
// after iTunes resolves them, which the base fixture does not model.
const RELATED_RELEASES: Readonly<Record<string, { itunesId: number; genre: string }>> = {
  'Glass Harbour': { itunesId: 7101, genre: 'Electronic' },
  'Slow Machines': { itunesId: 7102, genre: 'Electronic' },
  'Neon Field': { itunesId: 7103, genre: 'Dance' },
  'Paper Satellites': { itunesId: 7104, genre: 'Ambient' },
  'Low Atlas': { itunesId: 7107, genre: 'Indie' },
};

const relatedArtistResult = (name: string, release: { itunesId: number; genre: string }) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: release.itunesId,
  artistName: name,
  primaryGenreName: release.genre,
});

const relatedAlbumResult = (name: string, release: { itunesId: number; genre: string }) => ({
  wrapperType: 'collection',
  collectionType: 'Album',
  collectionId: release.itunesId * 10 + 1,
  collectionName: `${name} No. 1`,
  artistId: release.itunesId,
  artistName: name,
  primaryGenreName: release.genre,
  releaseDate: '2022-01-01T00:00:00Z',
  artworkUrl100: artwork(release.itunesId),
  collectionViewUrl: `https://music.apple.com/album/${release.itunesId * 10 + 1}`,
});

const relatedSongResult = (
  name: string,
  release: { itunesId: number; genre: string },
  n: number,
) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: release.itunesId * 100 + n,
  trackName: `${name} release ${n}`,
  artistId: release.itunesId,
  artistName: name,
  collectionId: release.itunesId * 10 + 1,
  collectionName: `${name} No. 1`,
  primaryGenreName: release.genre,
  releaseDate: `2022-0${n}-01T00:00:00Z`,
  artworkUrl100: artwork(`${release.itunesId}${n}`),
  previewUrl: n === 4 ? undefined : `https://audio.example.test/${release.itunesId}${n}.m4a`,
  trackViewUrl: `https://music.apple.com/album/${release.itunesId * 10 + 1}?i=${release.itunesId * 100 + n}`,
});

/** A short silent WAV so Chromium can actually start the media element. */
function silentWav(): Buffer {
  const sampleRate = 8000;
  const samples = 1600;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

export interface MockCatalogOptions {
  /**
   * Adjust one iTunes /search request before it is answered: delay it (to force
   * out-of-order responses), fail it once (to exercise the retry row), or answer
   * with a status such as 429 to exercise the rate-limit copy.
   */
  search?: (
    params: URLSearchParams,
    call: number,
  ) => { delayMs?: number; fail?: boolean; status?: number } | void;
  /** Also answer iTunes enrichment/album lookups for the anchors' related artists. */
  enrichRelatedArtists?: boolean;
  /** Serve the song fixtures' preview host so card samples can really play. */
  playAudio?: boolean;
}

/**
 * Mocks both catalog transports for one page. A request to either host that
 * the fixture does not know fails the test instead of passing through.
 */
export async function mockCatalog(page: Page, options: MockCatalogOptions = {}): Promise<void> {
  let searchCalls = 0;

  await page.route('https://itunes.apple.com/**', async (route) => {
    const url = new URL(route.request().url());
    let payload: unknown;
    if (url.pathname === '/search') {
      searchCalls += 1;
      const outcome = options.search?.(url.searchParams, searchCalls);
      if (outcome?.delayMs) await new Promise((resolve) => setTimeout(resolve, outcome.delayMs));
      if (outcome?.fail) {
        await route.abort('failed');
        return;
      }
      if (outcome?.status) {
        await route.fulfill({ status: outcome.status, body: '' });
        return;
      }
      payload = itunesSearch(url.searchParams);
    } else if (url.pathname === '/lookup') payload = itunesLookup(url.searchParams);
    if (payload === undefined) {
      throw new Error(`mockCatalog: unmatched iTunes request ${url.pathname}${url.search}`);
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(payload),
    });
  });

  await page.route('https://api.deezer.com/**', async (route) => {
    const url = new URL(route.request().url());
    let payload: unknown;
    if (url.pathname === '/search/artist') payload = deezerSearch(url.searchParams);
    else {
      const related = /^\/artist\/(\d+)\/related$/.exec(url.pathname);
      if (related) payload = deezerRelated(Number(related[1]));
    }
    if (payload === undefined) {
      throw new Error(`mockCatalog: unmatched Deezer request ${url.pathname}${url.search}`);
    }
    const callback = url.searchParams.get('callback') ?? 'callback';
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: `${callback}(${JSON.stringify(payload)});`,
    });
  });

  if (options.playAudio) {
    const wav = silentWav();
    await page.route('https://audio.example.test/**', (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'content-type': 'audio/wav',
          'content-length': String(wav.length),
          'accept-ranges': 'bytes',
        },
        body: wav,
      }),
    );
  }

  // Registered last so it answers related-artist requests first; everything
  // else falls through to the routes above.
  if (options.enrichRelatedArtists) {
    await page.route('https://itunes.apple.com/**', async (route) => {
      const url = new URL(route.request().url());
      const json = (payload: unknown) =>
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
          body: JSON.stringify(payload),
        });

      const name = url.searchParams.get('term') ?? '';
      const release = RELATED_RELEASES[name];
      if (url.pathname === '/search' && release) {
        await json({ resultCount: 1, results: [relatedArtistResult(name, release)] });
        return;
      }

      const album = Object.entries(RELATED_RELEASES).find(
        ([, item]) => item.itunesId === Number(url.searchParams.get('id')),
      );
      if (url.pathname === '/lookup' && url.searchParams.get('entity') === 'album' && album) {
        await json({ resultCount: 1, results: [relatedAlbumResult(album[0], album[1])] });
        return;
      }

      if (url.pathname === '/lookup' && url.searchParams.get('entity') === 'song' && album) {
        const results = [1, 2, 3, 4].map((n) => relatedSongResult(album[0], album[1], n));
        await json({ resultCount: results.length, results });
        return;
      }

      await route.fallback();
    });
  }
}
