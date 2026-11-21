import { describe, expect, it, vi } from 'vitest';
import { CatalogError } from '../types';
import { searchSeeds } from './itunes';

const ARTWORK_100 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg';
const ARTWORK_600 = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const mockFetch = (body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body));

const requestedUrl = (fetchMock: ReturnType<typeof mockFetch>) =>
  new URL(String(fetchMock.mock.calls[0][0]));

describe('searchSeeds', () => {
  it('asks iTunes for up to 8 matching artists', async () => {
    const fetchMock = mockFetch({ resultCount: 0, results: [] });

    await searchSeeds('  Ada Vale ', 'artist');

    const url = requestedUrl(fetchMock);
    expect(`${url.origin}${url.pathname}`).toBe('https://itunes.apple.com/search');
    expect(url.searchParams.get('term')).toBe('Ada Vale');
    expect(url.searchParams.get('media')).toBe('music');
    expect(url.searchParams.get('entity')).toBe('musicArtist');
    expect(url.searchParams.get('limit')).toBe('8');
  });

  it('asks iTunes for albums when the type is album', async () => {
    const fetchMock = mockFetch({ resultCount: 0, results: [] });

    await searchSeeds('ada', 'album');

    expect(requestedUrl(fetchMock).searchParams.get('entity')).toBe('album');
  });

  it('maps an artist result onto a seed candidate with its chips', async () => {
    mockFetch({
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
    });

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
    mockFetch({
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
    });

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
    mockFetch({
      resultCount: 2,
      results: [{ wrapperType: 'artist', artistName: 'No id here' }, { artistId: 7, artistName: 'Real One' }],
    });

    const candidates = await searchSeeds('x', 'artist');

    expect(candidates.map((candidate) => candidate.name)).toEqual(['Real One']);
  });

  it('rejects with a network CatalogError when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const failure = searchSeeds('ada', 'artist');

    await expect(failure).rejects.toBeInstanceOf(CatalogError);
    await expect(failure).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });
  });

  it('rejects with a network CatalogError when iTunes answers with an error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('busy', { status: 503 }));

    await expect(searchSeeds('ada', 'artist')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'network',
    });
  });
});
