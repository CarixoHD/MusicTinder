import { CatalogError, type Card, type Chip } from '../types';

// Stubs: the iTunes lookup adapter (genre enrichment, top tracks, albums)
// lands in its own slice.
export async function enrichArtist(name: string): Promise<{ itunesArtistId: number; chips: Chip[] } | null> {
  throw new CatalogError('unknown', `iTunes artist enrichment not implemented (${name})`);
}

export async function artistTopTracks(itunesArtistId: number, limit: number): Promise<Card[]> {
  throw new CatalogError('unknown', `iTunes top tracks not implemented (${itunesArtistId}, ${limit})`);
}

export async function artistAlbums(itunesArtistId: number, limit: number): Promise<Card[]> {
  throw new CatalogError('unknown', `iTunes albums not implemented (${itunesArtistId}, ${limit})`);
}
