import { CatalogError, type Card } from '../types';

// Stubs: the Deezer JSONP adapter lands in its own slice.
export async function resolveDeezerArtist(name: string): Promise<{ id: number; name: string } | null> {
  throw new CatalogError('unknown', `Deezer artist resolution not implemented (${name})`);
}

export async function relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]> {
  throw new CatalogError('unknown', `Deezer related artists not implemented (${deezerArtistId}, ${limit})`);
}
