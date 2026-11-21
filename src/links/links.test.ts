import { describe, expect, it } from 'vitest';
import { buildLink, type LinkItem } from './links';

const artist: LinkItem = { kind: 'artist', title: 'Ada Vale', creator: 'Ada Vale' };

const album: LinkItem = {
  kind: 'album',
  title: 'Ada Vale No. 1',
  creator: 'Ada Vale',
  appleUrl: 'https://music.apple.com/us/album/ada-vale-no-1/91011?uo=4',
};

const song: LinkItem = {
  kind: 'song',
  title: 'Night Bus',
  creator: 'Ada Vale',
  appleUrl: 'https://music.apple.com/us/album/night-bus/501?i=1001&uo=4',
};

describe('buildLink', () => {
  it('links Spotify by search with title and creator encoded', () => {
    expect(buildLink(artist, 'spotify')).toBe('https://open.spotify.com/search/Ada%20Vale');
    expect(buildLink(album, 'spotify')).toBe(
      'https://open.spotify.com/search/Ada%20Vale%20No.%201%20Ada%20Vale',
    );
    expect(buildLink(song, 'spotify')).toBe('https://open.spotify.com/search/Night%20Bus%20Ada%20Vale');
  });

  it('links YouTube Music by encoded q search', () => {
    expect(buildLink(artist, 'ytmusic')).toBe('https://music.youtube.com/search?q=Ada%20Vale');
    expect(buildLink(album, 'ytmusic')).toBe(
      'https://music.youtube.com/search?q=Ada%20Vale%20No.%201%20Ada%20Vale',
    );
    expect(buildLink(song, 'ytmusic')).toBe(
      'https://music.youtube.com/search?q=Night%20Bus%20Ada%20Vale',
    );
  });

  it('uses the Apple entity link and strips the uo tracking parameter', () => {
    expect(buildLink(song, 'apple')).toBe('https://music.apple.com/us/album/night-bus/501?i=1001');
    expect(buildLink(album, 'apple')).toBe('https://music.apple.com/us/album/ada-vale-no-1/91011');
  });

  it('falls back to an Apple Music search when the snapshot has no entity URL', () => {
    expect(buildLink(artist, 'apple')).toBe('https://music.apple.com/us/search?term=Ada%20Vale');

    const { appleUrl: _unused, ...withoutEntity } = song;
    expect(buildLink(withoutEntity, 'apple')).toBe(
      'https://music.apple.com/us/search?term=Night%20Bus%20Ada%20Vale',
    );
  });

  it('URL-encodes characters that would break a path or query', () => {
    const awkward: LinkItem = {
      kind: 'song',
      title: 'AC/DC — Back & Forth #1?',
      creator: 'Rock + Roll',
    };

    expect(buildLink(awkward, 'spotify')).toBe(
      'https://open.spotify.com/search/AC%2FDC%20%E2%80%94%20Back%20%26%20Forth%20%231%3F%20Rock%20%2B%20Roll',
    );
    expect(buildLink(awkward, 'ytmusic')).toBe(
      'https://music.youtube.com/search?q=AC%2FDC%20%E2%80%94%20Back%20%26%20Forth%20%231%3F%20Rock%20%2B%20Roll',
    );
    expect(buildLink(awkward, 'apple')).toBe(
      'https://music.apple.com/us/search?term=AC%2FDC%20%E2%80%94%20Back%20%26%20Forth%20%231%3F%20Rock%20%2B%20Roll',
    );
  });
});
