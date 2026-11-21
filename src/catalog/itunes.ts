import { CatalogError, type SeedCandidate } from '../types';

// Stub: the iTunes Search adapter lands in its own slice. Callers only see
// the Catalog interface, so replacing this body never touches index.ts.
export async function searchSeeds(term: string, type: 'artist' | 'album'): Promise<SeedCandidate[]> {
  throw new CatalogError('unknown', `iTunes search not implemented (${type}: ${term})`);
}
