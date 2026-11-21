import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CatalogError } from '../types';
import { searchSeeds } from './itunes';

const ARTWORK_100 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg';
const ARTWORK_600 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';
const SEARCH = 'https://itunes.apple.com/search';

let requested: URL | null = null;

/** Answers the real search URL with fixture JSON, recording what was asked. */
const searchAnswers = (body: Record<string, unknown>) =>
  http.get(SEARCH, ({ request }) => {
    requested = new URL(request.url);
    return HttpResponse.json(body);
  });

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  requested = null;
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
});
