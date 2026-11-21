import { CatalogError, type Card, type CardKind, type Catalog, type Seed } from '../types';

const RELATED_LIMIT = 20;
const GENRE_ANCHOR_LIMIT = 3;
const ALBUM_LIMIT = 3;
const TRACK_LIMIT = 3;
/** Liked artists are extra anchors, but seeds must keep the bulk of the iTunes budget. */
export const LIKED_ANCHOR_LIMIT = 2;

interface Anchor {
  /** Artist name used for catalog resolution/enrichment. */
  name: string;
  creatorKey: string;
  deezerArtistId?: number;
}

/** An artist the listener liked this deck, expanded as a second-hop anchor. */
export interface LikedAnchor {
  name: string;
  creatorKey: string;
}

export interface GenerateOptions {
  /** Liked this deck, most recent first; only the first LIKED_ANCHOR_LIMIT are expanded. */
  likedAnchors?: readonly LikedAnchor[];
  /** creatorKeys already in the deck pool: enriching them again would waste budget. */
  poolCreatorKeys?: ReadonlySet<string>;
}

/**
 * Build the raw candidate pool for one refill: Deezer related artists as the
 * spine, iTunes lookups to turn an artist into album/song cards. Uses only the
 * Catalog interface. Best effort: a failing anchor or enrichment is skipped;
 * the refill rejects only when failures leave nothing to deal.
 */
export async function generateCandidates(
  catalog: Catalog,
  seeds: Seed[],
  cardType: CardKind,
  seenKeys: ReadonlySet<string>,
  options: GenerateOptions = {},
): Promise<Card[]> {
  let failures = 0;
  let lastError: unknown;
  let networkError: CatalogError | undefined;

  const recordFailure = (error: unknown) => {
    // 'notfound' is the catalog answering "nothing there", not an outage.
    if (!(error instanceof CatalogError) || error.kind !== 'notfound') {
      failures += 1;
      lastError = error;
      if (error instanceof CatalogError && error.kind === 'network') networkError = error;
    }
  };

  const attempt = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await call();
    } catch (error) {
      recordFailure(error);
      return undefined;
    }
  };

  // A partial outage that leaves nothing to deal is still an outage: reporting
  // an empty deck would tell the listener their seeds are exhausted. A real
  // outage outranks a budget cool-down, which failed requests themselves cause.
  const finish = (cards: Card[]): Card[] => {
    if (cards.length === 0 && failures > 0) {
      if (networkError) throw networkError;
      throw lastError instanceof CatalogError ? lastError : new CatalogError('unknown', String(lastError));
    }
    return cards;
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

  // Second hop: artists liked this deck open their own related artists. Added
  // after the seeds and capped, so a like is an anchor that weighs less.
  for (const liked of (options.likedAnchors ?? []).slice(0, LIKED_ANCHOR_LIMIT)) {
    addAnchor({ name: liked.name, creatorKey: liked.creatorKey });
  }

  // Seed artists themselves (and anchors) never come back as candidates.
  const excluded = new Set(anchorMap.keys());

  // 2. Resolve each anchor to its Deezer id(s) when the seed does not carry one.
  const resolved: (Anchor & { deezerArtistIds: number[] })[] = [];
  for (const anchor of anchorMap.values()) {
    if (anchor.deezerArtistId !== undefined) {
      resolved.push({ ...anchor, deezerArtistIds: [anchor.deezerArtistId] });
      continue;
    }
    const found = await attempt(() => catalog.resolveDeezerArtist(anchor.name));
    if (found) resolved.push({ ...anchor, deezerArtistIds: [found.id, ...(found.alternatives ?? []).map((a) => a.id)] });
  }

  // 3. Related artists per anchor. A duplicate profile can answer with no
  //    related artists at all: try the next same-name profile before giving up
  //    on the anchor. A seed saved in an older session can carry a dead id, so
  //    fall back to resolving its name; a dead id is never asked twice in a run.
  const deadIds = new Set<number>();
  /** The error is kept so callers can tell a dead profile from a retryable outage. */
  const tryRelated = async (deezerArtistId: number): Promise<{ cards?: Card[]; error?: unknown }> => {
    try {
      return { cards: await catalog.relatedArtists(deezerArtistId, RELATED_LIMIT) };
    } catch (error) {
      recordFailure(error);
      return { error };
    }
  };

  const lookupRelated = async (ids: number[], stopOnOutage = false) => {
    for (const deezerArtistId of ids) {
      if (deadIds.has(deezerArtistId)) continue;
      const result = await tryRelated(deezerArtistId);
      if (result.cards?.length) return { cards: result.cards, outage: false };
      deadIds.add(deezerArtistId);
      // An outage would only make the name lookup wait out the same failure again.
      if (stopOnOutage && result.error && !(result.error instanceof CatalogError && result.error.kind === 'unknown')) {
        return { outage: true };
      }
    }
    return { outage: false };
  };

  const perAnchor: { anchorKey: string; cards: Card[] }[] = [];
  for (const anchor of resolved) {
    const stored = anchor.deezerArtistId !== undefined;
    let outcome = await lookupRelated(anchor.deezerArtistIds, stored);
    if (!outcome.cards && !outcome.outage && stored) {
      const found = await attempt(() => catalog.resolveDeezerArtist(anchor.name));
      if (found) outcome = await lookupRelated([found.id, ...(found.alternatives ?? []).map((a) => a.id)]);
    }
    if (!outcome.cards?.length) continue;
    perAnchor.push({
      anchorKey: anchor.creatorKey,
      cards: outcome.cards.filter(
        (card) => card.kind === 'artist' && !seenKeys.has(card.key) && !excluded.has(card.creatorKey),
      ),
    });
  }

  // Merge the anchors round-robin, deduped by creatorKey with the anchors
  // behind each card. Enrichment follows this order, so a cool-down takes one
  // head-of-list card from each anchor instead of draining the first anchor.
  const related = new Map<string, Card>();
  const longest = Math.max(0, ...perAnchor.map((list) => list.cards.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of perAnchor) {
      const card = list.cards[index];
      if (!card) continue;
      const existing = related.get(card.creatorKey);
      if (existing) {
        existing.related = [...new Set([...(existing.related ?? []), list.anchorKey])];
      } else {
        related.set(card.creatorKey, { ...card, related: [list.anchorKey] });
      }
    }
  }

  // Candidates the pool already holds need no enrichment this refill.
  const artists = [...related.values()].filter((card) => !options.poolCreatorKeys?.has(card.creatorKey));

  // 4a. Artist cards: Deezer carries no genre, so iTunes supplies it. Every
  //     card needs one: an artist without chips has no ranking signal and no
  //     card content. An artist iTunes could not tag stays unseen, and a later
  //     refill retries it.
  if (cardType === 'artist') {
    const tagged = await Promise.all(
      artists.map(async (card): Promise<Card | undefined> => {
        const enrichment = await attempt(() => catalog.enrichArtist(card.creator));
        return enrichment && enrichment.chips.length > 0
          ? { ...card, chips: enrichment.chips }
          : undefined;
      }),
    );
    return finish(tagged.filter((card): card is Card => card !== undefined));
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
