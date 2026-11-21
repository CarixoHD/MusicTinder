import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../types';
import { resetItunesBudget } from './budget';
import { createCatalog } from './index';

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

const ITUNES_SEARCH = 'https://itunes.apple.com/search';

const artistResult = (artistId: number, artistName: string) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId,
  artistName,
  primaryGenreName: 'Electronic',
});

const itunesSearches: string[] = [];
const server = setupServer(
  http.get(ITUNES_SEARCH, ({ request }) => {
    itunesSearches.push(request.url);
    return HttpResponse.json({
      resultCount: 1,
      results: [artistResult(9101, 'Ada Vale')],
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  resetItunesBudget();
  itunesSearches.length = 0;
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  for (const observer of observers.splice(0)) observer.disconnect();
});
afterAll(() => server.close());

describe('createCatalog', () => {
  it('composes all seven methods', () => {
    const catalog: Catalog = createCatalog();
    expect(Object.keys(catalog).sort()).toEqual([
      'artistAlbums',
      'artistTopTracks',
      'enrichArtist',
      'relatedArtists',
      'resolveDeezerArtist',
      'samplePreview',
      'searchSeeds',
    ]);
  });

  it('wires the real adapters (no stubs remain)', async () => {
    const catalog = createCatalog();
    const { enrichArtist, artistTopTracks, artistAlbums, samplePreview } = await import('./itunesLookup');
    const { relatedArtists, resolveDeezerArtist } = await import('./deezer');

    expect(catalog.enrichArtist).toBe(enrichArtist);
    expect(catalog.artistTopTracks).toBe(artistTopTracks);
    expect(catalog.artistAlbums).toBe(artistAlbums);
    expect(catalog.samplePreview).toBe(samplePreview);
    expect(catalog.relatedArtists).toBe(relatedArtists);
    expect(catalog.resolveDeezerArtist).toBe(resolveDeezerArtist);
  });

  it('answers an artist search from Deezer and asks iTunes for nothing', async () => {
    serveScripts(() => ({
      data: [
        { id: 414858642, name: 'Carpenter Brut', nb_fan: 6 },
        { id: 4346304, name: 'Carpenter Brut', nb_fan: 84_217 },
      ],
    }));

    const candidates = await createCatalog().searchSeeds('Carpenter Brut', 'artist', {
      wait: true,
    });

    expect(candidates.map((candidate) => candidate.deezerArtistId)).toEqual([4346304]);
    expect(candidates[0]?.fans).toBe(84_217);
    // The typing path spends no iTunes token: the deck keeps its budget.
    expect(itunesSearches).toEqual([]);
  });

  it('keeps generation’s genre-anchor search on iTunes, never Deezer', async () => {
    // Generation calls searchSeeds without options to turn a genre like 'Pop'
    // into anchor artists; Deezer matches artist names only and would anchor
    // on obscure acts whose name contains the genre.
    const { srcs } = serveScripts(() => ({ data: [{ id: 1, name: 'POP', nb_fan: 10 }] }));

    const candidates = await createCatalog().searchSeeds('Pop', 'artist');

    expect(candidates).toMatchObject([{ itunesId: 9101, name: 'Ada Vale' }]);
    expect(srcs).toEqual([]);
    expect(itunesSearches).toHaveLength(1);
    expect(itunesSearches[0]).toContain('term=Pop');
  });

  it('falls back to iTunes when Deezer errors', async () => {
    serveScripts(() => ({ error: { type: 'DataException', message: 'quota', code: 4 } }));

    const candidates = await createCatalog().searchSeeds('ada', 'artist', { wait: true });

    expect(candidates).toMatchObject([{ itunesId: 9101, name: 'Ada Vale' }]);
    expect(itunesSearches).toHaveLength(1);
  });

  it('falls back to iTunes when Deezer times out', async () => {
    vi.useFakeTimers();
    serveScripts(() => undefined); // never answers: the JSONP timeout has to fire

    const pending = createCatalog().searchSeeds('ada', 'artist', { wait: true });
    await vi.advanceTimersByTimeAsync(8_000);
    const candidates = await pending;

    expect(candidates).toMatchObject([{ itunesId: 9101, name: 'Ada Vale' }]);
    expect(itunesSearches).toHaveLength(1);
  });

  it('keeps album search on iTunes and never asks Deezer', async () => {
    const { srcs } = serveScripts(() => ({ data: [] }));
    server.use(
      http.get(ITUNES_SEARCH, () =>
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

    const candidates = await createCatalog().searchSeeds('ada', 'album', { wait: true });

    expect(candidates).toMatchObject([{ itunesId: 91011, kind: 'album' }]);
    expect(srcs).toEqual([]);
  });
});
