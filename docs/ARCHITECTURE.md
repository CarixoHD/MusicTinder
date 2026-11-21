# Architecture — Music Tinder

A no-backend, mobile-first PWA whose core product is one hot loop: **swipe → taste
update → next card**. All catalog access goes through one `Catalog` interface; all
recommendation logic is pure client-side scoring; all state lives in `localStorage`.
Static bundle, three screens + a settings sheet, no router library.

Base decision: ADR-001 (structure), ADR-002 (catalog sources), ADR-003 (hosting +
persistence + links). Research evidence underpinning every choice is in
`docs/research/`.

## Stack (verified versions, installed and built in the sandbox 2026-11-21)

| Package | Version | Role |
| --- | --- | --- |
| `react` / `react-dom` | 19.3.1 | UI |
| `motion` | 14.14.0 | springs, layout, drag hand-off (`m` + `LazyMotion`, `domMax` lazy chunk) |
| `@use-gesture/react` | 10.3.1 | pointer drag → MotionValues (transform-only, 60 fps) |
| `zustand` | 5.1.0 | state + `persist` middleware → localStorage |
| `vite` | 8.3.8 | build (rolldown — **requires `"type": "module"` in package.json**) |
| `@vitejs/plugin-react` | 6.3.0 | JSX/fast-refresh |
| `vite-plugin-pwa` | 2.0.0 | manifest, maskable icons, Workbox SW |
| `typescript` | 5.9.3 | typechecking (`--noEmit`), strict |
| `@types/react` | 19.2.x | React types |
| `vitest` | 5.1.1 (+ `jsdom` 31.0.1) | unit tests |
| `@playwright/test` | 1.65.1 | e2e (Chromium headless-shell default; WebKit project opt-in) |
| `@axe-core/playwright` | 4.14.0 | a11y scans (WCAG 2.1 AA tags) |
| `eslint` 9.39.1 + `typescript-eslint` 8.46.4 + `eslint-plugin-react-hooks` 7.0.1 | lint |

Node ≥ 22.12. Deploy: Cloudflare Pages, site root (`wrangler pages deploy dist`).

## Module map

Dependency rule: `ui → deck → {taste, catalog, audio, links}` and everything
persistence-shaped goes through `store`. `catalog` is the **only** module that
touches the network. Nothing imports from `ui` except `main.tsx` and `ui/`.

### `src/catalog/` — the network boundary

The only code that knows iTunes or Deezer exist. Normalizes both sources into one
`Card` shape and maps raw genre strings → curated chips. Owns caching and the
rate budget so the rest of the app is rate-blind.

```ts
// src/catalog/types.ts
interface Catalog {
  searchSeeds(term: string, type: 'artist' | 'album'): Promise<SeedCandidate[]>;
  relatedArtists(deezerArtistId: number, limit: number): Promise<CardCandidate[]>; // artists, pictures embedded
  artistTopTracks(itunesArtistId: number, limit: number): Promise<CardCandidate[]>; // songs, iTunes previewUrl
  artistAlbums(itunesArtistId: number, limit: number): Promise<CardCandidate[]>;    // albums, artwork + genre
}
```

- `itunes.ts` — plain `fetch()`; `/search` (seed search), `/lookup?id&entity=song|album`
  (top tracks, albums, genre ids, artwork). CORS `*`, `max-age=86400` → 24 h cache.
- `deezerJsonp.ts` — the **only** JSONP anywhere: script-tag loader with timeout;
  returns `{data}` or unknown-error. Lives here so a future edge proxy is a
  one-file swap (deferred issue).
- `deezer.ts` — `/search/artist` (seed resolution + artist id anchors),
  `/artist/{id}/related` (candidate spine, carries `picture_medium/big`).
- `cache.ts` — localStorage cache, TTL 24 h, LRU-capped (~300 entries).
  **Deezer preview URLs are never cached or persisted** (signed, ~15 min TTL);
  cards only ever carry iTunes previews.
- `budget.ts` — iTunes token bucket (~17 req/min); serialised lookups; cool-down
  resolves with **un-enriched** candidates (fallback art, "no sample") instead of
  blocking the deck.

### `src/chips.ts` — genre taxonomy

~30 curated chips + one pure normalizer (`normalizeGenre(src): Chip[]`): map table
(e.g. `Hip-Hop/Rap → hip-hop`, `R&B/Soul → r&b-soul`), split on `/ & -`, catch-all
`other`. Pure data + one function; no API calls. Deezer's ~21 coarse genres are
never chips. Unseen raw genre strings log once at dev time; taxonomy grows only via
a shipped table change + test.

### `src/taste/` — the recommender (pure, synchronous, no I/O)

Rocchio-style relevance feedback over chips + creators. The entire PRD story 5
lives here.

```ts
type TasteWeights = { chips: Record<Chip, number>; creators: Record<string, number> };
initTaste(seeds: Seed[]): TasteWeights;                 // β-weighted from seed chips + creators
applyFeedback(t, r: Reaction): t + TasteDelta;           // like +β/δ; skip −γ; elapsedMs<5000 → skip discounted
score(t, c: Card): { score: number; because?: string };  // dot product; 'because' = argmax seed/liked contributor
```

- `TasteDelta` is **additive and invertible** (`applyInverse`) and persisted per
  swipe — undo (story 11) and session wrap-up (story 12) later read existing data.
- Skips demote only the card's chips/creator, never a family-wide penalty
  (implicit-feedback caveat: a skip is not a rating).
- Test rule: unit tests assert **ranking rules** (like raises the family, skip
  demotes it, seen never re-queues), never fixture-specific answers.

### `src/deck/` — the hot path

State machine owning the candidate pool, the ≥5-card prefetched queue and deck
status. Every user action is **one synchronous commit** (< ~5 ms) — taste update +
pool re-rank + next-card promotion + one localStorage write — after which
prefetch/refill and audio preload run fire-and-forget. No network on the commit path.

```ts
type DeckStatus = 'dealing' | 'empty' | 'stalled'; // empty → quiet deck-end; stalled → refill failed, retry
createDeck(catalog, cache): {
  refill(state): Promise<DeckState>;             // background; every ~8–10 swipes; stays inside iTunes budget
  commit(state, r: Reaction): { next; status };  // synchronous; seen-exclusion; never repeats
  prefetchQueue(state): Card[];                  // next 3–5 cards already in DOM
};
```

Constants: `MIN_POOL 15`, `REFILL_EVERY 8–10 swipes`, `PREFETCH_AHEAD 5`,
quality floor `score ≥ 0` (no junk, story 10). Generated asymmetrically: artists
from Deezer `/related`; songs/albums from iTunes lookups of those artists.

### `src/audio/` — preview engine

```ts
class PreviewPlayer {
  unlockOnGesture(): Promise<void>;         // first-gesture sticky activation; re-runs each cold PWA launch
  play(card: Card): 'playing' | 'nosample'; // slot A; failure NEVER blocks the card lifecycle
  preload(next: Card): void;                // slot B: src + load() → target <300 ms start
  setMuted(m)/stop();
}
```

Two reused `<audio preload="auto">` elements in an A/B double-buffer (WebKit's
recommended swap-sources-on-same-element pattern). `MEDIA_ERR_NETWORK` (code 2) →
backoff retry + `online`/`visibilitychange` listeners; code 4 / missing preview →
first-class "no sample" card state, still swipeable. Never Web Audio, never
created-per-card.

### `src/links/` — deep links (pure functions)

```ts
buildLink(item, app: 'spotify' | 'apple' | 'ytmusic'): string;
// apple: exact entity from iTunes trackViewUrl/collectionViewUrl (strip &uo=4); search fallback
// spotify: https://open.spotify.com/search/{q};  ytmusic: https://music.youtube.com/search?q={q}
```

Unit tests pin the verified canonical formats.

### `src/store/` — state + persistence

One zustand store; `persist` middleware → localStorage under one namespaced,
versioned root (`mt:v1.*`), `migrate(oldState)` on load, corrupt/partial state
tolerated (defaults + inline notice). Runtime-only (pool, current card, prefetch
buffer, deck status) is derivable and never persisted.

Slices & actions: `seeds` (`addSeed/removeSeed` — unresolvable seeds flagged inline
at entry), `settings` (`musicApp: spotify|apple|ytmusic; sound; theme: system|dark|light`),
`taste`, `liked` (append-only full card snapshots → Liked renders with zero network),
`seen` (capped ~5 000, oldest pruned), `catalogCache`, `ui screen`
(`setup | discovery | liked` — a store field; the Settings sheet is not a screen).
Screen routing has no router library.

### `src/ui/` — presentation

- `theme.ts` — system/dark/light resolution (persisted override), live
  `matchMedia` re-read, dual `<meta name="theme-color">` pairs, manifest colours.
- `transition.ts` — `withTransition(fn)`: feature-detected View Transitions API,
  else ≤120 ms cross-fade; instant when `prefers-reduced-motion: reduce` reports live.
- `screens/Setup.tsx` — search-as-you-type seed pickers (catalog) + genre chip grid; ≥1 seed gates the deck.
- `screens/Discovery.tsx` + `Card.tsx` — drag via `@use-gesture` → MotionValues
  (transform-only), release springs via `m` + LazyMotion (`domMax` chunk lazy
  after first paint), `<MotionConfig reducedMotion="user">` at root. Like/skip =
  swipe + buttons + ←/→ keys. Next 3–5 cards rendered ahead.
- `screens/Liked.tsx`, `screens/SettingsSheet.tsx` — quiet list; sheet with music
  app, sound, theme, reset-all (with confirmation).

### `src/testkit/` — first-class test seam

`FakeCatalog` (deterministic fixtures) for units; shared Playwright fixtures:
route fulfilment for **both** transports at the network layer (iTunes JSON via
`route.fulfill`, Deezer JSONP via script-body fulfil, context
`serviceWorkers: 'block'`), `emulateMedia({ reducedMotion: 'reduce' })` variants,
AxeBuilder helper (`wcag2a/2aa/21a/21aa`). The live catalog is never called.

## Data model (localStorage, `mt:v1.*`, schema version + `migrate()`)

```
seeds     Seed[]            { id, kind: artist|album|genre, name, itunesArtistId?, deezerArtistId?, itunesCollectionId?, chips }
settings  { musicApp 'spotify'|'apple'|'ytmusic'; sound: bool; theme 'system'|'dark'|'light' }
taste     TasteWeights      { chips, creators }                    // updated every swipe
liked     LikedItem[]       { key, kind, title, creator, year?, chips, image, previewUrl?, because?, }
seen      { key, ts }[]     dealt candidate keys, ring-capped ~5 000
catalogCache  { v, ts }     adapters' raw responses, TTL 24 h, LRU ~300; iTunes previews only
```

Shared types in a single `src/types.ts` (no module-local duplicates):

- `Chip` — curated chip string (`'hip-hop'`, `'r&b-soul'`, `'other'`, …)
- `Card` — normalized candidate: `{ key, kind: artist|album|song, source, title,
  creator, creatorKey, year?, image, previewUrl?, chips, because? }` —
  `key = it:track:<id> | dz:artist:<id> | it:album:<id>`
- `Reaction` — `{ card, reaction: 'like'|'skip', elapsedMs }`
- Runtime-only: pool, current card, prefetch buffer, deck status.

## Key flows

**Cold start → deck.** `mt:v1.seeds` empty → Setup. Seeds added (catalog search;
genres from chip grid). ≥1 seed → Discovery; `initTaste(seeds)` → `deck.refill()`
builds pool (Deezer related for artist anchors, iTunes lookups to enrich, dedupe
against `seen`) → rank → ≥5 cards rendered; first card's preview preloads.

**Swipe commit (synchronous).** Reaction fires → `taste.applyFeedback` → store
write (taste + seen; + liked on like) → `deck.commit` re-ranks remaining pool,
promotes next card, hands it to `player.preload` → UI springs. Total JS < 5 ms;
settle < 100 ms. Refill triggers in background when queue < REFILL threshold.

**Deck end.** Pool exhausted below quality floor → quiet end state: "fresh deck"
(re-refill, same seeds) and "change seeds" (→ Setup). Refill failure → `stalled`
inline retry; already-dealt cards stay swipeable offline.

**Open in music app.** Like → `buildLink(item, settings.musicApp)`; one tap opens
the https universal link; iPhone routes into the installed app.

**Reload.** Persisted slices rehydrate (`migrate()`); pool rebuilt from seeds +
taste + seen + cache; nothing the user chose is ever lost.

## Testing strategy

- **Units (Vitest, jsdom)**: scoring orders by taste weights; like raises, skip
  demotes (with the < 5 s discount rule); seen never re-queued; localStorage
  round-trip across a simulated reload; reduced-motion preference read live and
  re-read when it changes; link builders pinned to canonical URLs. Rule-based
  assertions, never fixture answers.
- **E2E (Playwright, Chromium headless-shell default; WebKit project opt-in)**:
  one core-loop test with the catalog mocked at the network layer
  (`route.fulfill`, JSONP served as script body, `serviceWorkers: 'block'`):
  cold start → add seed → card deals → play/pause → swipe right → Liked → reload →
  state survives. Second pass with `reducedMotion: 'reduce'`: card must not
  fling/rotate. Axe scans on Setup/Discovery/Liked with `withTags('wcag2a',
  'wcag2aa', 'wcag21a', 'wcag21aa')`; keyboard-only like/skip.
- **Rules**: the live catalog is never called in tests; fixtures only; no flaky
  network tests; any scoring change ships with the test that pins it; tests are
  never weakened to pass.

## Running locally

```bash
npm install          # exact pinned versions; Node ≥ 22.12
npm run dev          # vite dev server; listens on $PORT + 0.0.0.0 when HOST=0.0.0.0
npm run test         # vitest (jsdom)
npx vitest run src/taste/taste.test.ts   # single test file
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test:e2e     # playwright: first run `npm run test:e2e:install` for browsers
npm run build        # production bundle + service worker into dist/
```

The dev command honours `$PORT` and `HOST=0.0.0.0` (owner opens the app over
plain HTTP from another machine). App state lives in the browser: there is no
server data; a fresh profile starts the Setup screen; a seeded test helper in
`?seedDemo=1` populates example seeds/likes for testers (see AGENTS.md).
