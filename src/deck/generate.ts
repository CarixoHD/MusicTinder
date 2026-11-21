import { CatalogError, type Card, type CardKind, type Catalog, type Seed } from '../types';

const RELATED_LIMIT = 20;
const GENRE_ANCHOR_LIMIT = 3;
const ALBUM_LIMIT = 3;
const TRACK_LIMIT = 3;
const CHIP_ENRICH_LIMIT = 5;

interface Anchor {
  /** Artist name used for catalog resolution/enrichment. */
  name: string;
  creatorKey: string;
  deezerArtistId?: number;
}

/**
 * Build the raw candidate pool for one refill: Deezer related artists as the
 * spine, iTunes lookups to turn an artist into album/song cards. Uses only the
 * Catalog interface. Best effort: a failing anchor or enrichment is skipped;
 * only when every catalog call failed does the refill reject.
 */
export async function generateCandidates(
  catalog: Catalog,
  seeds: Seed[],
  cardType: CardKind,
  seenKeys: ReadonlySet<string>,
): Promise<Card[]> {
  let calls = 0;
  let failures = 0;
  let lastError: unknown;

  const attempt = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
    calls += 1;
    try {
      return await call();
    } catch (error) {
      failures += 1;
      lastError = error;
      return undefined;
    }
  };

  const finish = <T>(value: T): T => {
    if (calls > 0 && failures === calls) {
      throw lastError instanceof CatalogError ? lastError : new CatalogError('unknown', String(lastError));
    }
    return value;
  };

  // 1. Anchors: artist seeds, the artist behind an album seed, and one search
  //    per genre seed. Deduplicated by creatorKey.
  const anchorMap = new Map<string, Anchor>();
  const addAnchor = (anchor: Anchor) => {
    const existing = anchorMap.get(anchor.creatorKey);
    if (existing) existing.deezerArtistId ??= anchor.deezerArtistId;
    else anchorMap.set(anchor.creatorKey, { ...anchor });
  };

  for (const seed of seeds) {
    if (seed.kind === 'artist') {
      addAnchor({
        name: seed.name,
        creatorKey: seed.creatorKey ?? seed.name.trim().toLowerCase(),
        deezerArtistId: seed.deezerArtistId,
      });
    } else if (seed.kind === 'album' && seed.creatorKey) {
      // A seed stores the artist only as a normalised creatorKey.
      addAnchor({ name: seed.creatorKey, creatorKey: seed.creatorKey, deezerArtistId: seed.deezerArtistId });
    }
  }

  for (const seed of seeds) {
    if (seed.kind !== 'genre') continue;
    const hits = await attempt(() => catalog.searchSeeds(seed.name, 'artist'));
    for (const hit of (hits ?? []).slice(0, GENRE_ANCHOR_LIMIT)) {
      addAnchor({ name: hit.name, creatorKey: hit.creator.trim().toLowerCase() });
    }
  }

  // Seed artists themselves (and anchors) never come back as candidates.
  const excluded = new Set(anchorMap.keys());

  // 2. Resolve each anchor to a Deezer id when the seed does not carry one.
  const resolved: (Anchor & { deezerArtistId: number })[] = [];
  for (const anchor of anchorMap.values()) {
    if (anchor.deezerArtistId !== undefined) {
      resolved.push({ ...anchor, deezerArtistId: anchor.deezerArtistId });
      continue;
    }
    const found = await attempt(() => catalog.resolveDeezerArtist(anchor.name));
    if (found) resolved.push({ ...anchor, deezerArtistId: found.id });
  }

  // 3. Related artists, deduped by creatorKey, merging the anchors behind them.
  const related = new Map<string, Card>();
  for (const anchor of resolved) {
    const candidates = await attempt(() => catalog.relatedArtists(anchor.deezerArtistId, RELATED_LIMIT));
    for (const card of candidates ?? []) {
      if (card.kind !== 'artist' || seenKeys.has(card.key) || excluded.has(card.creatorKey)) continue;
      const existing = related.get(card.creatorKey);
      if (existing) {
        existing.related = [...new Set([...(existing.related ?? []), anchor.creatorKey])];
      } else {
        related.set(card.creatorKey, { ...card, related: [anchor.creatorKey] });
      }
    }
  }

  const artists = [...related.values()];

  // 4a. Artist cards: best-effort genre enrichment for the first few.
  if (cardType === 'artist') {
    await Promise.all(
      artists.slice(0, CHIP_ENRICH_LIMIT).map(async (card) => {
        const enrichment = await attempt(() => catalog.enrichArtist(card.creator));
        if (enrichment && enrichment.chips.length > 0) card.chips = enrichment.chips;
      }),
    );
    return finish(artists);
  }

  // 4b. Album/song cards: enrich each related artist, then pull its releases,
  //     carrying the anchor keys and the artist's chips onto every card.
  const loadReleases = (itunesArtistId: number): Promise<Card[]> =>
    cardType === 'album'
      ? catalog.artistAlbums(itunesArtistId, ALBUM_LIMIT)
      : catalog.artistTopTracks(itunesArtistId, TRACK_LIMIT);

  const cards: Card[] = [];
  const included = new Set<string>();
  for (const artistCard of artists) {
    const enrichment = await attempt(() => catalog.enrichArtist(artistCard.creator));
    if (!enrichment) continue;
    const chips = enrichment.chips.length > 0 ? enrichment.chips : artistCard.chips;
    const releases = await attempt(() => loadReleases(enrichment.itunesArtistId));
    for (const card of releases ?? []) {
      if (card.kind !== cardType || seenKeys.has(card.key) || included.has(card.key)) continue;
      if (excluded.has(card.creatorKey)) continue;
      included.add(card.key);
      cards.push({ ...card, chips, related: artistCard.related });
    }
  }

  return finish(cards);
}
