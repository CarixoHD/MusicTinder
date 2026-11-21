import type { Chip } from './types';

/** The ~30 curated chips a seed can carry. Display labels are sentence-case. */
export const CHIPS: readonly { id: Chip; label: string }[] = [
  { id: 'hip-hop', label: 'Hip-hop' },
  { id: 'r&b-soul', label: 'R&B / soul' },
  { id: 'pop', label: 'Pop' },
  { id: 'rock', label: 'Rock' },
  { id: 'indie', label: 'Indie' },
  { id: 'alternative', label: 'Alternative' },
  { id: 'electronic', label: 'Electronic' },
  { id: 'dance', label: 'Dance' },
  { id: 'house', label: 'House' },
  { id: 'techno', label: 'Techno' },
  { id: 'metal', label: 'Metal' },
  { id: 'punk', label: 'Punk' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'blues', label: 'Blues' },
  { id: 'classical', label: 'Classical' },
  { id: 'folk', label: 'Folk' },
  { id: 'country', label: 'Country' },
  { id: 'singer-songwriter', label: 'Singer-songwriter' },
  { id: 'latin', label: 'Latin' },
  { id: 'reggae', label: 'Reggae' },
  { id: 'world', label: 'World' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'soundtrack', label: 'Soundtrack' },
  { id: 'funk', label: 'Funk' },
  { id: 'gospel', label: 'Gospel' },
  { id: 'disco', label: 'Disco' },
  { id: 'k-pop', label: 'K-pop' },
  { id: 'afrobeat', label: 'Afrobeat' },
  { id: 'experimental', label: 'Experimental' },
  { id: 'other', label: 'Other' },
];

/** Raw catalog genre (lower-case) -> curated chip. */
const GENRE_MAP: Record<string, Chip> = {
  'hip-hop/rap': 'hip-hop',
  'hip hop/rap': 'hip-hop',
  'hip-hop': 'hip-hop',
  'hip hop': 'hip-hop',
  rap: 'hip-hop',
  trap: 'hip-hop',
  'r&b/soul': 'r&b-soul',
  'r&b': 'r&b-soul',
  rnb: 'r&b-soul',
  soul: 'r&b-soul',
  pop: 'pop',
  rock: 'rock',
  'indie rock': 'indie',
  'indie pop': 'indie',
  indie: 'indie',
  alternative: 'alternative',
  alt: 'alternative',
  electronic: 'electronic',
  electronica: 'electronic',
  edm: 'electronic',
  dance: 'dance',
  house: 'house',
  techno: 'techno',
  metal: 'metal',
  'heavy metal': 'metal',
  punk: 'punk',
  jazz: 'jazz',
  blues: 'blues',
  classical: 'classical',
  folk: 'folk',
  country: 'country',
  'singer/songwriter': 'singer-songwriter',
  'singer-songwriter': 'singer-songwriter',
  latin: 'latin',
  latino: 'latin',
  reggae: 'reggae',
  world: 'world',
  worldwide: 'world',
  ambient: 'ambient',
  soundtrack: 'soundtrack',
  funk: 'funk',
  gospel: 'gospel',
  disco: 'disco',
  'k-pop': 'k-pop',
  afrobeat: 'afrobeat',
  experimental: 'experimental',
};

/**
 * Normalise one raw catalog genre string into curated chips.
 * Exact map hit first, then split on "/", "&" and "-"; anything unmapped
 * collapses to the `other` catch-all.
 */
export function normalizeGenre(raw: string): Chip[] {
  const key = raw.trim().toLowerCase();
  if (!key) return ['other'];

  const exact = GENRE_MAP[key];
  if (exact) return [exact];

  const chips = key
    .split(/[/&-]/)
    .map((part) => part.trim())
    .map((part) => GENRE_MAP[part])
    .filter((chip): chip is Chip => chip !== undefined);

  const unique = [...new Set(chips)];
  return unique.length > 0 ? unique : ['other'];
}
