import { useStore } from '../store/store';
import type { LikedItem, Seed } from '../types';

// Fixture values mirror src/testkit/fakeCatalog.ts and e2e/fixtures.ts so the
// demo profile and the automated tests show the same catalog names.

const SEEDS: Seed[] = [
  {
    id: 'it:artist:9101',
    kind: 'artist',
    name: 'Ada Vale',
    itunesArtistId: 9101,
    deezerArtistId: 4101,
    chips: ['electronic', 'ambient'],
    creatorKey: 'ada vale',
  },
  {
    id: 'it:artist:9102',
    kind: 'artist',
    name: 'North Static',
    itunesArtistId: 9102,
    deezerArtistId: 4102,
    chips: ['indie', 'rock'],
    creatorKey: 'north static',
  },
  {
    id: 'it:album:91011',
    kind: 'album',
    name: 'Ada Vale No. 1',
    itunesCollectionId: 91011,
    chips: ['electronic'],
    creatorKey: 'ada vale',
  },
  { id: 'genre:electronic', kind: 'genre', name: 'Electronic', chips: ['electronic'] },
  { id: 'genre:indie', kind: 'genre', name: 'Indie', chips: ['indie'] },
];

const LIKES: LikedItem[] = [
  {
    key: 'dz:artist:5101',
    kind: 'artist',
    title: 'Glass Harbour',
    creator: 'Glass Harbour',
    creatorKey: 'glass harbour',
    image: 'https://cdn.example.test/artists/5101.jpg',
    chips: ['electronic', 'ambient'],
    because: 'Ada Vale',
  },
  {
    key: 'it:album:91011',
    kind: 'album',
    title: 'Ada Vale No. 1',
    creator: 'Ada Vale',
    creatorKey: 'ada vale',
    year: 2019,
    image: 'https://cdn.example.test/art/91011.jpg',
    appleUrl: 'https://music.apple.com/album/91011?uo=4',
    chips: ['electronic'],
    because: 'Ada Vale',
  },
  {
    key: 'it:track:910102',
    kind: 'song',
    title: 'Ada Vale song 2',
    creator: 'Ada Vale',
    creatorKey: 'ada vale',
    year: 2022,
    image: 'https://cdn.example.test/art/91012.jpg',
    previewUrl: 'https://audio.example.test/91012.m4a',
    appleUrl: 'https://music.apple.com/album/91011?i=910102',
    chips: ['electronic'],
    because: 'Ada Vale',
  },
];

/**
 * `?seedDemo=1` fills a fresh profile with fixture seeds and likes, then opens
 * Discovery. An existing profile is left untouched (seeding twice duplicates).
 */
export function seedDemo(): void {
  if (new URLSearchParams(window.location.search).get('seedDemo') !== '1') return;

  const store = useStore.getState();
  if (store.seeds.length > 0 || store.liked.length > 0) return;

  SEEDS.forEach(store.addSeed);
  LIKES.forEach(store.addLiked);
  store.setScreen('discovery');
}
