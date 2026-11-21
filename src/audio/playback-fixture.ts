import type { Page } from '@playwright/test';

// Playwright network fixtures for the card-playback journey. Spec files call
// these helpers; app code never imports this module. Mirrors e2e/fixtures.ts:
// both catalog transports plus the preview host are answered at the network
// layer, so tests never reach the live catalog or a real audio CDN.

interface Artist {
  name: string;
  deezerId: number;
  itunesId: number;
}

const ARTISTS: readonly Artist[] = [
  { name: 'Glass Harbour', deezerId: 5101, itunesId: 9101 },
  { name: 'Slow Machines', deezerId: 5102, itunesId: 9102 },
  { name: 'Neon Field', deezerId: 5103, itunesId: 9103 },
];

const SEED = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9001,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

const artwork = (id: number) => `https://cdn.example.test/art/${id}/600x600bb.jpg`;

const artistResult = (artist: Artist) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: artist.itunesId,
  artistName: artist.name,
  primaryGenreName: 'Electronic',
  artistLinkUrl: `https://music.apple.com/artist/${artist.itunesId}`,
});

/** Every third track has no preview: the deck must stay swipeable without it. */
const songResult = (artist: Artist, n: number) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: artist.itunesId * 10 + n,
  trackName: `${artist.name} song ${n}`,
  artistId: artist.itunesId,
  artistName: artist.name,
  collectionId: artist.itunesId * 100,
  collectionName: `${artist.name} No. 1`,
  primaryGenreName: 'Electronic',
  releaseDate: `${2020 + n}-01-01T00:00:00Z`,
  artworkUrl100: artwork(artist.itunesId * 10 + n),
  previewUrl: n === 3 ? undefined : `https://audio.example.test/${artist.itunesId * 10 + n}.m4a`,
  trackViewUrl: `https://music.apple.com/album/${artist.itunesId * 100}?i=${artist.itunesId * 10 + n}`,
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

export async function mockPlaybackCatalog(page: Page): Promise<void> {
  const wav = silentWav();

  await page.route('https://itunes.apple.com/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/search') {
      const term = (url.searchParams.get('term') ?? '').toLowerCase();
      const results = ARTISTS.filter((artist) => artist.name.toLowerCase() === term).map(artistResult);
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ resultCount: results.length, results }),
      });
      return;
    }

    if (url.pathname === '/lookup') {
      const ids = (url.searchParams.get('id') ?? '').split(',').map(Number);
      const artists = ARTISTS.filter((artist) => ids.includes(artist.itunesId));
      const results = artists.flatMap((artist) => [1, 2, 3].map((n) => songResult(artist, n)));
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ resultCount: results.length, results }),
      });
      return;
    }

    throw new Error(`playback fixture: unmatched iTunes request ${url.pathname}${url.search}`);
  });

  await page.route('https://api.deezer.com/**', async (route) => {
    const url = new URL(route.request().url());
    const callback = url.searchParams.get('callback') ?? 'callback';
    const artistPayload = (artists: readonly Artist[]) => ({
      data: artists.map((artist) => ({
        id: artist.deezerId,
        name: artist.name,
        nb_fan: 1000,
        picture_medium: artwork(artist.deezerId),
        picture_big: artwork(artist.deezerId),
      })),
    });
    const reply = async (payload: { data: unknown[] }) =>
      route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'access-control-allow-origin': '*',
        },
        body: `${callback}(${JSON.stringify(payload)});`,
      });

    // Liking a card searches its creator so the next refill can expand it.
    if (url.pathname === '/search/artist') {
      const term = (url.searchParams.get('q') ?? '').toLowerCase();
      return reply(artistPayload(ARTISTS.filter((artist) => artist.name.toLowerCase() === term)));
    }
    const related = /^\/artist\/(\d+)\/related$/.exec(url.pathname);
    if (!related) throw new Error(`playback fixture: unmatched Deezer request ${url.pathname}${url.search}`);
    // Only the seed's related list deals artists; a liked artist's second hop is empty.
    return reply(artistPayload(Number(related[1]) === 4101 ? ARTISTS : []));
  });

  await page.route('https://audio.example.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(wav.length),
        'accept-ranges': 'bytes',
      },
      body: wav,
    });
  });
}

/** A returning listener's state: one artist seed, song cards, sound on. */
export async function seedSongDeck(page: Page): Promise<void> {
  const persisted = {
    state: {
      seeds: [SEED],
      settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType: 'song' },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
      seen: [],
    },
    version: 1,
  };
  await page.addInitScript((json) => {
    try {
      localStorage.setItem('mt:v1', json);
    } catch {
      // about:blank has no storage; the init script runs again on navigation.
    }
  }, JSON.stringify(persisted));
}
