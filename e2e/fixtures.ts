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

export interface MockCatalogOptions {
  /**
   * Adjust one iTunes /search request before it is answered: delay it (to force
   * out-of-order responses) or fail it once (to exercise the retry row).
   */
  search?: (params: URLSearchParams, call: number) => { delayMs?: number; fail?: boolean } | void;
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
}
