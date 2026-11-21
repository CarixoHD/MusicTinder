// Single source of every shared domain type. Modules import from here, never
// redefine Card/Chip/Seed/Reaction/TasteWeights locally.

/** Curated genre chip ids. Raw catalog genres are mapped onto these by chips.ts. */
export type Chip =
  | 'hip-hop'
  | 'r&b-soul'
  | 'pop'
  | 'rock'
  | 'indie'
  | 'alternative'
  | 'electronic'
  | 'dance'
  | 'house'
  | 'techno'
  | 'metal'
  | 'punk'
  | 'jazz'
  | 'blues'
  | 'classical'
  | 'folk'
  | 'country'
  | 'singer-songwriter'
  | 'latin'
  | 'reggae'
  | 'world'
  | 'ambient'
  | 'soundtrack'
  | 'funk'
  | 'gospel'
  | 'disco'
  | 'k-pop'
  | 'afrobeat'
  | 'experimental'
  | 'other';

export type CardKind = 'artist' | 'album' | 'song';

/** Apple marks these in the album title ("Bitch - Single"); the card shows it as a tag. */
export type ReleaseType = 'Single' | 'EP';

export type SeedKind = 'artist' | 'album' | 'genre';

export interface Seed {
  id: string;
  kind: SeedKind;
  name: string;
  itunesArtistId?: number;
  deezerArtistId?: number;
  itunesCollectionId?: number;
  chips: Chip[];
  creatorKey?: string;
  /** Artwork shown on the seed's pill in Setup. */
  image?: string;
}

/** A catalog search hit shown in Setup; never persisted until chosen. */
export interface SeedCandidate {
  /** Apple's id; absent for a Deezer fallback artist. */
  itunesId?: number;
  /** Deezer's id when the artist came from the Deezer fallback. */
  deezerArtistId?: number;
  kind: 'artist' | 'album';
  name: string;
  creator: string;
  year?: number;
  image?: string;
  chips: Chip[];
  /** Deezer fan count, shown in the row so duplicate profiles differ. */
  fans?: number;
}

/** How a Setup seed search may wait on the shared iTunes budget. */
export interface SeedSearchOptions {
  /** Wait for the next refill during a cool-down instead of failing fast. */
  wait?: boolean;
  /** Abandon the wait when the term changes. */
  signal?: AbortSignal;
}

export interface Card {
  key: string;
  kind: CardKind;
  source: 'itunes' | 'deezer';
  title: string;
  creator: string;
  /** Normalised lower-case artist name so iTunes and Deezer agree. */
  creatorKey: string;
  year?: number;
  image?: string;
  previewUrl?: string;
  appleUrl?: string;
  /** Album only: the release kind Apple appends to the title, shown as a tag. */
  releaseType?: ReleaseType;
  chips: Chip[];
  /** creatorKeys of the anchor artists this candidate came from. */
  related?: string[];
  /** Deezer fan count of the artist; absent when the catalog does not report one. */
  fans?: number;
  /** Deezer album count of a related artist; the artist card's tag when it has one genre. */
  albumCount?: number;
  /** Display name of the seed/liked item that produced the strongest score. */
  because?: string;
  /** Song title of the just-in-time sample attached by Discovery, when known. */
  sampleTitle?: string;
}

export interface Reaction {
  card: Card;
  reaction: 'like' | 'skip';
  elapsedMs: number;
}

export interface TasteWeights {
  chips: Partial<Record<Chip, number>>;
  creators: Record<string, number>;
  /** feature (chip id or creatorKey) -> display name of the seed/liked item behind it. */
  origins: Record<string, string>;
}

/** Additive, invertible taste change produced by one reaction. */
export interface TasteDelta {
  chips: Partial<Record<Chip, number>>;
  creators: Record<string, number>;
  origins: Record<string, string>;
}

export interface LikedItem {
  key: string;
  kind: CardKind;
  title: string;
  creator: string;
  creatorKey: string;
  year?: number;
  image?: string;
  previewUrl?: string;
  appleUrl?: string;
  chips: Chip[];
  because?: string;
}

export interface Settings {
  musicApp: 'spotify' | 'apple' | 'ytmusic';
  sound: boolean;
  theme: 'system' | 'dark' | 'light';
  cardType: CardKind;
}

export type DeckStatus = 'dealing' | 'empty' | 'stalled';

/** 'budget' is the app's own iTunes allowance, not the catalog failing. */
export type CatalogErrorKind = 'network' | 'rate' | 'budget' | 'notfound' | 'unknown';

export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;

  constructor(kind: CatalogErrorKind, message: string = kind) {
    super(message);
    this.name = 'CatalogError';
    this.kind = kind;
  }
}

/**
 * How a card-building lookup may wait on the shared iTunes budget instead of
 * failing the refill. Only the lookups for a deck's first card pass it.
 */
export interface LookupOptions {
  /** Wait for the next refill during a cool-down instead of answering "nothing to deal". */
  waitForBudget?: boolean;
}

/** A just-in-time preview and the song it belongs to. */
export interface Sample {
  previewUrl: string;
  /** The song's title, when the catalog reports one. */
  title?: string;
}

/** How a just-in-time preview lookup may wait on the shared iTunes budget. */
export interface SampleOptions {
  /** Wait for the next refill during a cool-down instead of reporting no sample. */
  waitForBudget?: boolean;
  /** The visible card's lookup is served before lower-priority (prefetch) lookups. */
  priority?: boolean;
  /** Abandon the wait when the card is no longer in play. */
  signal?: AbortSignal;
}

/** A Deezer artist profile. The search often lists an empty duplicate with the same name first. */
export interface DeezerArtistRef {
  id: number;
  name: string;
  /** Other profiles with the same name, most fans first; generation tries them if the first has no related artists. */
  alternatives?: DeezerArtistRef[];
}

export interface Catalog {
  searchSeeds(
    term: string,
    type: 'artist' | 'album',
    options?: SeedSearchOptions,
  ): Promise<SeedCandidate[]>;
  resolveDeezerArtist(name: string): Promise<DeezerArtistRef | null>;
  relatedArtists(deezerArtistId: number, limit: number): Promise<Card[]>;
  enrichArtist(
    name: string,
    options?: LookupOptions,
  ): Promise<{ itunesArtistId: number; chips: Chip[] } | null>;
  artistTopTracks(itunesArtistId: number, limit: number, options?: LookupOptions): Promise<Card[]>;
  artistAlbums(itunesArtistId: number, limit: number, options?: LookupOptions): Promise<Card[]>;
  /**
   * A just-in-time preview for a card that shipped without one; undefined when
   * there is none. With `waitForBudget` a cool-down is retried after a refill.
   */
  samplePreview(card: Card, options?: SampleOptions): Promise<Sample | undefined>;
}
