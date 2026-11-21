import type { Card, LikedItem, Settings } from '../types';

/** The music app a liked item opens in (a subset of Settings). */
export type MusicApp = Settings['musicApp'];

/** Everything a link needs; both Card and LikedItem satisfy it. */
export type LinkItem = Pick<Card, 'kind' | 'title' | 'creator' | 'appleUrl'>;

/** Artist cards search by name; songs and albums add the creator to disambiguate. */
const searchTerm = (item: LinkItem): string =>
  item.kind === 'artist' ? item.title : `${item.title} ${item.creator}`;

/** Apple links arrive with a `uo=4` tracking parameter; the app keeps them clean. */
const withoutTracking = (appleUrl: string): string => {
  try {
    const url = new URL(appleUrl);
    url.searchParams.delete('uo');
    return url.toString().replace(/\?$/, '');
  } catch {
    return appleUrl;
  }
};

/** One keyless https link per app; the OS routes it into the installed app. */
export function buildLink(item: LinkItem, app: MusicApp): string {
  const q = encodeURIComponent(searchTerm(item));

  switch (app) {
    case 'apple':
      return item.appleUrl
        ? withoutTracking(item.appleUrl)
        : `https://music.apple.com/us/search?term=${q}`;
    case 'spotify':
      return `https://open.spotify.com/search/${q}`;
    case 'ytmusic':
      return `https://music.youtube.com/search?q=${q}`;
  }
}
