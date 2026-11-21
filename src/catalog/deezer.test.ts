import { afterEach, describe, expect, it, vi } from 'vitest';
import { relatedArtists, resolveDeezerArtist } from './deezer';
import { jsonp } from './deezerJsonp';

const observers: MutationObserver[] = [];

/**
 * jsdom never executes external scripts, so the test plays the CDN: observe the
 * script the real loader appends and call its global callback with the reply.
 */
function serveScripts(reply: (src: string) => unknown) {
  const callbacks: string[] = [];
  const srcs: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLScriptElement)) continue;
        srcs.push(node.src);
        const callback = new URL(node.src).searchParams.get('callback') ?? '';
        callbacks.push(callback);
        queueMicrotask(() => {
          const handler = (window as unknown as Record<string, unknown>)[callback];
          if (typeof handler === 'function') (handler as (payload: unknown) => void)(reply(node.src));
        });
      }
    }
  });
  observer.observe(document.head, { childList: true });
  observers.push(observer);
  return { callbacks, srcs };
}

const jsonpScripts = () => document.querySelectorAll('script[src*="output=jsonp"]');
const dzGlobals = () => Object.keys(window).filter((key) => key.startsWith('__dz_jsonp_'));

afterEach(() => {
  vi.useRealTimers();
  for (const observer of observers.splice(0)) observer.disconnect();
});

describe('deezer JSONP transport', () => {
  it('delivers the payload and removes the script tag and global callback', async () => {
    const { callbacks, srcs } = serveScripts(() => ({ data: [{ id: 27, name: 'Daft Punk' }] }));

    const result = await jsonp<{ data: { id: number; name: string }[] }>(
      'https://api.deezer.com/search/artist?q=daft%20punk',
    );

    expect(result.data[0]).toEqual({ id: 27, name: 'Daft Punk' });
    expect(srcs[0]).toContain('output=jsonp&callback=');
    expect(jsonpScripts()).toHaveLength(0);
    expect((window as unknown as Record<string, unknown>)[callbacks[0]]).toBeUndefined();
    expect(dzGlobals()).toEqual([]);
  });

  it('uses a unique callback per request', async () => {
    const { callbacks } = serveScripts(() => ({ data: [] }));

    await Promise.all([
      jsonp('https://api.deezer.com/artist/27'),
      jsonp('https://api.deezer.com/artist/28'),
    ]);

    expect(callbacks).toHaveLength(2);
    expect(new Set(callbacks).size).toBe(2);
  });

  it('rejects with a network CatalogError and cleans up when the callback never fires', async () => {
    vi.useFakeTimers();

    const pending = jsonp('https://api.deezer.com/artist/27');
    const assertion = expect(pending).rejects.toMatchObject({ name: 'CatalogError', kind: 'network' });

    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(jsonpScripts()).toHaveLength(0);
    expect(dzGlobals()).toEqual([]);
  });

  it('maps a Deezer error payload to a typed CatalogError and cleans up', async () => {
    serveScripts(() => ({ error: { type: 'DataException', message: 'no data', code: 800 } }));

    await expect(jsonp('https://api.deezer.com/artist/0')).rejects.toMatchObject({
      name: 'CatalogError',
      kind: 'notfound',
    });

    expect(jsonpScripts()).toHaveLength(0);
    expect(dzGlobals()).toEqual([]);
  });
});

describe('relatedArtists', () => {
  it('maps Deezer artists to artist Cards with dz keys, picture_big images and normalised creatorKey', async () => {
    const { srcs } = serveScripts(() => ({
      data: [
        {
          id: 99,
          name: 'Justice',
          picture_big: 'https://cdn-images.dzcdn.net/artist/99/500x500.jpg',
          picture_medium: 'https://cdn-images.dzcdn.net/artist/99/250x250.jpg',
        },
        { id: 100, name: 'Daft PUNK', picture_big: 'https://cdn-images.dzcdn.net/artist/100/500x500.jpg' },
      ],
    }));

    const cards = await relatedArtists(27, 5);

    expect(srcs[0]).toContain('/artist/27/related');
    expect(cards).toEqual([
      {
        key: 'dz:artist:99',
        kind: 'artist',
        source: 'deezer',
        title: 'Justice',
        creator: 'Justice',
        creatorKey: 'justice',
        image: 'https://cdn-images.dzcdn.net/artist/99/500x500.jpg',
        chips: [],
      },
      {
        key: 'dz:artist:100',
        kind: 'artist',
        source: 'deezer',
        title: 'Daft PUNK',
        creator: 'Daft PUNK',
        creatorKey: 'daft punk',
        image: 'https://cdn-images.dzcdn.net/artist/100/500x500.jpg',
        chips: [],
      },
    ]);
  });

  it('keeps no Deezer preview URL on any card', async () => {
    serveScripts(() => ({
      data: [
        {
          id: 99,
          name: 'Justice',
          picture_big: 'https://cdn-images.dzcdn.net/artist/99/500x500.jpg',
          preview: 'https://cdnt-preview.dzcdn.net/api/1/justice.mp3',
          preview_url: 'https://cdnt-preview.dzcdn.net/api/1/justice.mp3',
        },
      ],
    }));

    const cards = await relatedArtists(27, 5);

    expect(cards).toHaveLength(1);
    expect(cards.every((card) => card.previewUrl === undefined)).toBe(true);
  });

  it('returns at most `limit` related artists', async () => {
    serveScripts(() => ({
      data: [1, 2, 3, 4].map((id) => ({ id, name: `Artist ${id}` })),
    }));

    expect(await relatedArtists(27, 2)).toHaveLength(2);
  });
});

describe('resolveDeezerArtist', () => {
  it('returns the exact name match when the search has several hits', async () => {
    const { srcs } = serveScripts(() => ({
      data: [
        { id: 2, name: 'Daft Punk Tribute' },
        { id: 1, name: 'Daft Punk' },
      ],
    }));

    expect(await resolveDeezerArtist('daft punk')).toEqual({ id: 1, name: 'Daft Punk' });
    expect(srcs[0]).toContain('/search/artist?q=daft%20punk');
  });

  it('picks the same-name profile with the most fans, listing the rest as alternatives', async () => {
    serveScripts(() => ({
      data: [
        { id: 414858642, name: 'Carpenter Brut', nb_fan: 6 },
        { id: 4346304, name: 'Carpenter Brut', nb_fan: 84217 },
        { id: 7, name: 'Carpenter Brut Tribute', nb_fan: 900000 },
      ],
    }));

    expect(await resolveDeezerArtist('Carpenter Brut')).toEqual({
      id: 4346304,
      name: 'Carpenter Brut',
      alternatives: [{ id: 414858642, name: 'Carpenter Brut' }],
    });
  });

  it('keeps an exact name match ahead of a partial one with more fans', async () => {
    serveScripts(() => ({
      data: [
        { id: 1, name: 'Kavinsky Tribute Band', nb_fan: 900000 },
        { id: 13358, name: 'Kavinsky', nb_fan: 500000 },
      ],
    }));

    expect(await resolveDeezerArtist('kavinsky')).toEqual({ id: 13358, name: 'Kavinsky' });
  });

  it('keeps the search order when same-name profiles have the same fans', async () => {
    serveScripts(() => ({
      data: [
        { id: 7, name: 'Kavinsky', nb_fan: 100 },
        { id: 8, name: 'Kavinsky', nb_fan: 100 },
      ],
    }));

    expect(await resolveDeezerArtist('Kavinsky')).toMatchObject({ id: 7 });
  });

  it('returns null when the search has no results', async () => {
    serveScripts(() => ({ data: [] }));

    expect(await resolveDeezerArtist('nobody at all')).toBeNull();
  });

  it('returns null when no result carries the name', async () => {
    serveScripts(() => ({ data: [{ id: 5, name: 'Someone Else' }] }));

    expect(await resolveDeezerArtist('ada vale')).toBeNull();
  });
});
