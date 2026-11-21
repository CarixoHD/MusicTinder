import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchDeezerArtists } from './deezerSeeds';

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

afterEach(() => {
  vi.useRealTimers();
  for (const observer of observers.splice(0)) observer.disconnect();
});

describe('searchDeezerArtists', () => {
  it('maps Deezer search hits onto artist seed candidates with fans, picture_medium and the other chip', async () => {
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

    const candidates = await searchDeezerArtists('Carpenter Brut');

    expect(srcs[0]).toContain('/search/artist?q=Carpenter%20Brut');
    expect(srcs[0]).toContain('limit=8');
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

  it('drops rows without an id or name instead of guessing', async () => {
    serveScripts(() => ({
      data: [{ name: 'No id' }, { id: 5 }, { id: 6, name: 'Real One' }],
    }));

    const candidates = await searchDeezerArtists('real');

    expect(candidates.map((candidate) => candidate.deezerArtistId)).toEqual([6]);
  });

  it('keeps Deezer errors typed so Setup can explain them', async () => {
    serveScripts(() => ({ error: { type: 'DataException', message: 'quota', code: 4 } }));

    await expect(searchDeezerArtists('ada')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'rate',
    });
  });
});
