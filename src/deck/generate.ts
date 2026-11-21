import { CHIPS } from '../chips';
import { CatalogError, type Card, type CardKind, type Catalog, type Chip, type Seed } from '../types';

const RELATED_LIMIT = 20;
const GENRE_ANCHOR_LIMIT = 3;
const ALBUM_LIMIT = 3;
const TRACK_LIMIT = 3;
/** Exploration is a small share of a refill, not a second deck. */
export const WILDCARD_CARDS = 2;
/** The most iTunes enrichments a refill may spend looking for wildcards. */
export const WILDCARD_ENRICH_LIMIT = 2;
/** Liked artists are extra anchors, but seeds must keep the bulk of the iTunes budget. */
export const LIKED_ANCHOR_LIMIT = 2;
/**
 * Related artists a fresh deck may hold for an iTunes token. Past this the rest
 * are looked up best effort; the ones the spent budget refuses are reported to
 * the deck as a retryable cool-down, never as a dry deck. Otherwise a seed whose
 * artists all miss would sit in "getting ready" for minutes.
 */
export const WAIT_ARTIST_LIMIT = 6;

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
  /**
   * The deck has no cards: the first card's lookups may wait out the app's own
   * iTunes cool-down instead of rejecting the refill. A background refill, with
   * cards in hand, never waits.
   */
  waitForFirstCard?: boolean;
  /** Generate exploration cards outside the listener's top chips. */
  wildcards?: boolean;
  /** The listener's strongest taste chips: a wildcard's chips stay outside these. */
  topChips?: readonly Chip[];
  /** Counts refills, so successive ones explore different chips (never per swipe). */
  wildcardTurn?: number;
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
  /** The app's own iTunes allowance refused an artist: it was never checked. */
  let budgetError: CatalogError | undefined;
  /** A failure other than the app's own iTunes allowance: a real catalog problem. */
  let hardFailure = false;
  /** The first real failure, so a later cool-down cannot hide it. */
  let hardError: unknown;

  const recordFailure = (error: unknown) => {
    // 'notfound' is the catalog answering "nothing there", not an outage.
    if (!(error instanceof CatalogError) || error.kind !== 'notfound') {
      failures += 1;
      lastError = error;
      if (error instanceof CatalogError && error.kind === 'budget') {
        budgetError ??= error;
      } else {
        hardFailure = true;
        hardError ??= error;
      }
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

  // Exploration is best effort: a failed wildcard lookup must never turn a
  // healthy deck into an outage, or a cool-down into "Couldn't reach the catalog".
  const quietly = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await call();
    } catch {
      return undefined;
    }
  };

  // A partial outage that leaves nothing to deal is still an outage: reporting
  // an empty deck would tell the listener their seeds are exhausted. A real
  // outage outranks a budget cool-down, which failed requests themselves cause.
  // A cool-down that refused artists is neither: they were never checked, so
  // the caller gets a budget error and retries once the window refills. Only a
  // deck whose artists were all checked may report "nothing there".
  const finish = (cards: Card[]): Card[] => {
    if (cards.length === 0 && failures > 0) {
      if (networkError) throw networkError;
      if (!hardFailure) throw budgetError ?? new CatalogError('budget', 'iTunes is cooling down');
      const error = hardError ?? lastError;
      throw error instanceof CatalogError ? error : new CatalogError('unknown', String(error));
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

  const enrichCard = async (card: Card, waitForBudget: boolean): Promise<Card | undefined> => {
    const enrichment = await attempt(() => catalog.enrichArtist(card.creator, { waitForBudget }));
    return enrichment && enrichment.chips.length > 0 ? { ...card, chips: enrichment.chips } : undefined;
  };

  const loadReleases = (itunesArtistId: number, waitForBudget: boolean): Promise<Card[]> =>
    cardType === 'album'
      ? catalog.artistAlbums(itunesArtistId, ALBUM_LIMIT, { waitForBudget })
      : catalog.artistTopTracks(itunesArtistId, TRACK_LIMIT, { waitForBudget });

  const outside = (chips: readonly Chip[]): boolean =>
    chips.length > 0 && chips.every((chip) => !(options.topChips ?? []).includes(chip));

  /**
   * Mix a couple of exploration cards into the refill: unseen, outside the
   * listener's top chips, from the least-represented seed branch or from a
   * genre search on a curated chip they have not picked. Successive refills
   * take turns through the chips. Off means no wildcard request at all.
   */
  const withWildcards = async (regular: Card[]): Promise<Card[]> => {
    if (options.wildcards !== true || (options.topChips ?? []).length === 0) return regular;

    const found: Card[] = [];
    const taken = new Set<string>();

    // 1. The least-represented seed branch: a related artist outside the top
    //    chips. These were enriched anyway, so this costs no extra token.
    if (perAnchor.length > 0) {
      const least = [...perAnchor].sort((a, b) => a.cards.length - b.cards.length)[0];
      for (const card of regular) {
        if (found.length >= WILDCARD_CARDS) break;
        if (!card.related?.includes(least.anchorKey) || !outside(card.chips)) continue;
        found.push({ ...card, wildcard: true, because: undefined });
        taken.add(card.key);
      }
    }

    // 2. No branch artist is outside the taste: search a curated chip the
    //    listener has not picked. The album entity is what makes the term find
    //    the genre: an artist search only matches acts *named* after it, while
    //    album hits are tagged with the genre they belong to and carry artwork.
    //    A hit counts only when its own genre is the chip, so an album merely
    //    titled "Jazz" cannot pose as one. Album wildcards are those hits; the
    //    artist/song ones are built from them and spend at most
    //    WILDCARD_ENRICH_LIMIT enrichments.
    if (found.length === 0) {
      const seedChips = new Set(seeds.flatMap((seed) => seed.chips));
      const unpicked = CHIPS.filter(
        (chip) => !seedChips.has(chip.id) && !(options.topChips ?? []).includes(chip.id),
      );
      if (unpicked.length > 0) {
        const chip = unpicked[(options.wildcardTurn ?? 0) % unpicked.length];
        const hits = (await quietly(() => catalog.searchSeeds(chip.label, 'album'))) ?? [];
        let spent = 0;
        for (const hit of hits) {
          if (found.length >= WILDCARD_CARDS) break;
          if (!hit.chips.includes(chip.id) || !outside(hit.chips)) continue;
          const creatorKey = hit.creator.trim().toLowerCase();
          if (excluded.has(creatorKey) || options.poolCreatorKeys?.has(creatorKey)) continue;

          // The search hit is the release itself: artwork and genre included,
          // so an album wildcard costs no enrichment.
          if (cardType === 'album' && hit.itunesId !== undefined) {
            const key = `it:album:${hit.itunesId}`;
            if (seenKeys.has(key)) continue;
            found.push({
              key,
              kind: 'album',
              source: 'itunes',
              title: hit.name,
              creator: hit.creator,
              creatorKey,
              year: hit.year,
              image: hit.image,
              chips: hit.chips,
              related: [],
              wildcard: true,
            });
            continue;
          }

          if (spent >= WILDCARD_ENRICH_LIMIT) break;
          spent += 1;
          const enrichment = await quietly(() => catalog.enrichArtist(hit.creator, { waitForBudget: false }));
          if (!enrichment || !outside(enrichment.chips)) continue;
          if (cardType === 'artist') {
            const key = `it:artist:${enrichment.itunesArtistId}`;
            if (seenKeys.has(key)) continue;
            found.push({
              key,
              kind: 'artist',
              source: 'itunes',
              title: hit.creator,
              creator: hit.creator,
              creatorKey,
              image: hit.image,
              chips: enrichment.chips,
              related: [],
              wildcard: true,
            });
            continue;
          }
          const releases = await quietly(() => loadReleases(enrichment.itunesArtistId, false));
          const release = (releases ?? []).find(
            (card) => card.kind === cardType && !seenKeys.has(card.key) && !excluded.has(card.creatorKey),
          );
          if (release) found.push({ ...release, chips: enrichment.chips, related: [], wildcard: true });
        }
      }
    }

    return [...regular.filter((card) => !taken.has(card.key)), ...found];
  };

  // 4a. Artist cards: Deezer carries no genre, so iTunes supplies it. Every
  //     card needs one: an artist without chips has no ranking signal and no
  //     card content. An artist iTunes could not tag stays unseen, and a later
  //     refill retries it.
  if (cardType === 'artist') {
    // Wait out the cool-down until an artist is actually tagged, not for one
    // fixed index: iTunes may not know the first related artist at all. Bounded,
    // so a seed whose artists all miss still answers quickly; any artist the
    // spent budget then refuses is reported by finish as a retryable cool-down.
    const tagged: Card[] = [];
    let index = 0;
    if (options.waitForFirstCard === true) {
      const bound = Math.min(artists.length, WAIT_ARTIST_LIMIT);
      while (index < bound && tagged.length === 0) {
        const card = await enrichCard(artists[index], true);
        index += 1;
        if (card) tagged.push(card);
      }
    }
    const rest = await Promise.all(artists.slice(index).map((card) => enrichCard(card, false)));
    return finish(await withWildcards([...tagged, ...rest.filter((card): card is Card => card !== undefined)]));
  }

  // 4b. Album/song cards: enrich each related artist, then pull its releases,
  //     carrying the anchor keys and the artist's chips onto every card.
  const cards: Card[] = [];
  const included = new Set<string>();
  for (const [index, artistCard] of artists.entries()) {
    // Hold the deck for a token only while it has no card at all, so a first
    // related artist iTunes cannot match does not cost the next ones their wait.
    const waitForBudget =
      options.waitForFirstCard === true && cards.length === 0 && index < WAIT_ARTIST_LIMIT;
    const enrichment = await attempt(() => catalog.enrichArtist(artistCard.creator, { waitForBudget }));
    if (!enrichment) continue;
    const chips = enrichment.chips.length > 0 ? enrichment.chips : artistCard.chips;
    const releases = await attempt(() => loadReleases(enrichment.itunesArtistId, waitForBudget));
    for (const card of releases ?? []) {
      if (card.kind !== cardType || seenKeys.has(card.key) || included.has(card.key)) continue;
      if (excluded.has(card.creatorKey)) continue;
      included.add(card.key);
      cards.push({ ...card, chips, related: artistCard.related });
    }
  }

  return finish(await withWildcards(cards));
}
