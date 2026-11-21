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
        { id: 4346304, name: 'Carpenter Brut', nb_fan: 84_217 },
        {
          id: 600,
          name: 'Kavinsky',
          picture_medium: 'https://cdn-images.dzcdn.net/artist/600/250x250.jpg',
          nb_fan: 500_000,
        },
      ],
    }));

    const candidates = await searchDeezerArtists('Carpenter Brut');

    expect(srcs[0]).toContain('/search/artist?q=Carpenter%20Brut');
    expect(srcs[0]).toContain('limit=8');
    // Fans decide the order: the main profile sits above lookalikes.
    expect(candidates).toEqual([
      {
        deezerArtistId: 600,
        kind: 'artist',
        name: 'Kavinsky',
        creator: 'Kavinsky',
        image: 'https://cdn-images.dzcdn.net/artist/600/250x250.jpg',
        chips: ['other'],
        fans: 500_000,
      },
      {
        deezerArtistId: 4346304,
        kind: 'artist',
        name: 'Carpenter Brut',
        creator: 'Carpenter Brut',
        image: undefined,
        chips: ['other'],
        fans: 84_217,
      },
    ]);
  });

  it('ranks by fan count and hides an exact-name duplicate with under 1% of the top hit’s fans', async () => {
    serveScripts(() => ({
      data: [
        { id: 414858642, name: 'Carpenter Brut', nb_fan: 6 },
        { id: 4346304, name: 'Carpenter Brut', nb_fan: 84_217 },
        { id: 500132, name: 'Kavinsky', nb_fan: 132 },
        { id: 600, name: 'Kavinsky', nb_fan: 500_000 },
        // A different act with few fans is not a duplicate: it stays.
        { id: 700, name: 'Little Band', nb_fan: 3 },
      ],
    }));

    const candidates = await searchDeezerArtists('carpenter brut kavinsky');

    expect(candidates.map((candidate) => candidate.deezerArtistId)).toEqual([
      600, // Kavinsky, 500k
      4346304, // Carpenter Brut, 84k
      700, // Little Band, 3
    ]);
    expect(candidates.map((candidate) => candidate.fans)).toEqual([500_000, 84_217, 3]);
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
