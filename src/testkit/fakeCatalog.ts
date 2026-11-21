import type { Card, Catalog, Chip, SeedCandidate } from '../types';

interface Anchor {
  name: string;
  deezerId: number;
  itunesId: number;
  chips: Chip[];
}

const ANCHORS: readonly Anchor[] = [
  { name: 'Ada Vale', deezerId: 4101, itunesId: 9101, chips: ['electronic', 'ambient'] },
  { name: 'North Static', deezerId: 4102, itunesId: 9102, chips: ['indie', 'rock'] },
  { name: 'Lumen Choir', deezerId: 4103, itunesId: 9103, chips: ['r&b-soul', 'jazz'] },
];

interface RelatedSeed {
  name: string;
  deezerId: number;
  chips: Chip[];
  anchor: number;
}

const RELATED: readonly RelatedSeed[] = [
  { name: 'Glass Harbour', deezerId: 5101, chips: ['electronic', 'ambient'], anchor: 0 },
  { name: 'Slow Machines', deezerId: 5102, chips: ['electronic', 'house'], anchor: 0 },
  { name: 'Neon Field', deezerId: 5103, chips: ['electronic', 'dance'], anchor: 0 },
  { name: 'Paper Satellites', deezerId: 5104, chips: ['ambient', 'experimental'], anchor: 0 },
  { name: 'Wire Assembly', deezerId: 5105, chips: ['electronic', 'techno'], anchor: 0 },
  { name: 'Tidal Rooms', deezerId: 5106, chips: ['ambient', 'classical'], anchor: 0 },
  { name: 'Low Atlas', deezerId: 5107, chips: ['indie', 'electronic'], anchor: 0 },
  { name: 'Mira Chase', deezerId: 5108, chips: ['pop', 'dance'], anchor: 0 },
  { name: 'Fever Orchard', deezerId: 5201, chips: ['indie', 'rock'], anchor: 1 },
  { name: 'Salt Lines', deezerId: 5202, chips: ['indie', 'folk'], anchor: 1 },
  { name: 'Static Bloom', deezerId: 5203, chips: ['alternative', 'punk'], anchor: 1 },
  { name: 'The Quiet Hours', deezerId: 5204, chips: ['indie', 'singer-songwriter'], anchor: 1 },
  { name: 'Copper Kites', deezerId: 5205, chips: ['rock', 'blues'], anchor: 1 },
  { name: 'Hollow Pines', deezerId: 5206, chips: ['folk', 'country'], anchor: 1 },
  { name: 'Marble Youth', deezerId: 5207, chips: ['alternative', 'metal'], anchor: 1 },
  { name: 'Second Coast', deezerId: 5208, chips: ['indie', 'pop'], anchor: 1 },
  { name: 'Velvet Ledger', deezerId: 5301, chips: ['r&b-soul', 'funk'], anchor: 2 },
  { name: 'Sunday Grammar', deezerId: 5302, chips: ['r&b-soul', 'jazz'], anchor: 2 },
  { name: 'Nia Bloom', deezerId: 5303, chips: ['r&b-soul', 'gospel'], anchor: 2 },
  { name: 'Basement Gold', deezerId: 5304, chips: ['funk', 'disco'], anchor: 2 },
  { name: 'Quiet Engine', deezerId: 5305, chips: ['jazz', 'experimental'], anchor: 2 },
  { name: 'Ana Reed', deezerId: 5306, chips: ['singer-songwriter', 'folk'], anchor: 2 },
  { name: 'Blue Sunday', deezerId: 5307, chips: ['blues', 'r&b-soul'], anchor: 2 },
  { name: 'Lagos Line', deezerId: 5308, chips: ['afrobeat', 'world'], anchor: 2 },
];

const creatorKey = (name: string) => name.trim().toLowerCase();

const anchorOf = (itunesArtistId: number) => ANCHORS.find((a) => a.itunesId === itunesArtistId);

const relatedCards = (): Card[] =>
  RELATED.map((r) => {
    const anchor = ANCHORS[r.anchor];
    return {
      key: `dz:artist:${r.deezerId}`,
      kind: 'artist',
      source: 'deezer',
      title: r.name,
      creator: r.name,
      creatorKey: creatorKey(r.name),
      image: `https://cdn.example.test/artists/${r.deezerId}.jpg`,
      chips: r.chips,
      related: anchor ? [creatorKey(anchor.name)] : [],
    };
  });

/**
 * Deterministic in-memory catalog for units and shell work. Three anchor
 * artists, 24 related artists across many chips, and some cards that
 * deliberately carry no previewUrl.
 */
export class FakeCatalog implements Catalog {
  async searchSeeds(term: string, type: 'artist' | 'album'): Promise<SeedCandidate[]> {
    const needle = term.trim().toLowerCase();
    const matches = (name: string) => needle === '' || name.toLowerCase().includes(needle);

    if (type === 'artist') {
      return ANCHORS.filter((a) => matches(a.name)).map((a) => ({
        itunesId: a.itunesId,
        kind: 'artist',
        name: a.name,
        creator: a.name,
        image: `https://cdn.example.test/artists/${a.itunesId}.jpg`,
        chips: a.chips,
      }));
    }

    return ANCHORS.filter((a) => matches(`${a.name} No. 1`)).map((a) => ({
      itunesId: a.itunesId + 1000,
      kind: 'album',
      name: `${a.name} No. 1`,
      creator: a.name,
      year: 2021,
      image: `https://cdn.example.test/albums/${a.itunesId + 1000}.jpg`,
      chips: a.chips,
    }));
  }

  async resolveDeezerArtist(name: string): Promise<{ id: number; name: string } | null> {
    const key = creatorKey(name);
    const anchor = ANCHORS.find((a) => creatorKey(a.name) === key);
    return anchor ? { id: anchor.deezerId, name: anchor.name } : null;
  }

  async relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
    const index = ANCHORS.findIndex((a) => a.deezerId === deezerArtistId);
    if (index === -1) return [];
    const cards = relatedCards().filter((card) => card.related?.[0] === creatorKey(ANCHORS[index].name));
    return cards.slice(0, limit);
  }

  async enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
    const key = creatorKey(name);
    const anchor = ANCHORS.find((a) => creatorKey(a.name) === key);
    return anchor ? { itunesArtistId: anchor.itunesId, chips: anchor.chips } : null;
  }

  async artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
    const anchor = anchorOf(itunesArtistId);
    if (!anchor) return [];
    const tracks = [1, 2, 3, 4].map((n): Card => ({
      key: `it:track:${itunesArtistId}${n}`,
      kind: 'song',
      source: 'itunes',
      title: `${anchor.name} song ${n}`,
      creator: anchor.name,
      creatorKey: creatorKey(anchor.name),
      year: 2020 + n,
      image: `https://cdn.example.test/tracks/${itunesArtistId}${n}.jpg`,
      // One deliberate no-preview card: the deck must stay swipeable without it.
      previewUrl: n === 3 ? undefined : `https://audio.example.test/${itunesArtistId}${n}.m4a`,
      appleUrl: `https://music.apple.com/album/${itunesArtistId}?i=${itunesArtistId}${n}`,
      chips: anchor.chips,
    }));
    return tracks.slice(0, limit);
  }

  async artistAlbums(itunesArtistId: number, limit: number): Promise<Card[]> {
    const anchor = anchorOf(itunesArtistId);
    if (!anchor) return [];
    const albums = [1, 2, 3].map((n): Card => ({
      key: `it:album:${itunesArtistId}${n}`,
      kind: 'album',
      source: 'itunes',
      title: `${anchor.name} No. ${n}`,
      creator: anchor.name,
      creatorKey: creatorKey(anchor.name),
      year: 2018 + n,
      image: `https://cdn.example.test/albums/${itunesArtistId}${n}.jpg`,
      previewUrl: n === 2 ? undefined : `https://audio.example.test/${itunesArtistId}${n}.m4a`,
      appleUrl: `https://music.apple.com/album/${itunesArtistId}${n}`,
      chips: anchor.chips,
    }));
    return albums.slice(0, limit);
  }
}
