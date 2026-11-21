# Music tinder — Product Requirements

## Problem

Music discovery is stuck between two bad modes: streaming-service algorithms that are opaque black boxes you can only skip, and manual digging (blogs, Reddit threads, RateYourMusic lists) that takes hours and dozens of tabs.

Neither lets a listener say quickly and specifically *what they want more of*: "more like this album, less like that one", "artists only, from these three genres", "albums that sound like X but aren't Y". Feedback is coarse (a thumbs-down on a playlist) or missing entirely.

The result: listeners re-listen to the same things, or abandon discovery and let an algorithm decide, with no sense of taste ownership.

## Solution

A mobile-first, installable web app (PWA, add-to-home-screen) with a Tinder-style discovery loop for music.

1. **Seed**: the listener enters genres, artists and albums they like, and picks what they want recommended right now — artists, albums or songs.
2. **Swipe & listen**: the app deals recommendation cards one at a time (artwork, name, a few facts). A short audio sample of the card's music plays (or is one tap from playing on the first card, per browser autoplay rules) so the listener can judge by ear without leaving the app. Swipe/tap right = like, left = skip. Each reaction immediately feeds a local taste model that re-ranks the following cards, so the deck visibly improves within a session.
3. **Keep**: likes collect into a Liked list to revisit, each with one tap to open that artist/album/song in the listener's music app.

No account: taste and likes live in the browser's local storage on the device. The product is one screen at a time, fast, quiet, and beautiful — Apple Music / Linear / Vercel-grade restraint, subtle motion on every transition, respects the OS "reduce motion" setting, light and dark mode.

## Users

**Primary — the active listener (the owner).** Wants to find new artists and albums that fit a specific mood/seed they already have in mind, and wants their judgement to count. Uses a phone, one-handed, in short sessions (waiting for coffee, on the train). Cares about taste and about the interface not wasting their time.

**Secondary — the bored playlist listener.** Has run out of new music inside their streaming app, doesn't want to read reviews, but will happily swipe for two minutes to find three new things.

Both: one device, one person. No accounts, no sharing, no multi-user in scope.

## User Stories

1. As a listener, I want to enter the genres, artists and albums I like, so that the app has something to recommend from.
2. As a listener, I want to choose whether I'm shown artists, albums or songs right now, so that the deck matches what I'm in the mood to find.
3. As a listener, I want to swipe a card right to like it or left to skip it, so that I can judge recommendations fast, one-handed.
4. As a listener, I want to hear a short audio sample from each card's music, so that I can judge it by ear without leaving the app.
5. As a listener, I want my likes and skips to change the cards that come next, so that the deck gets better as I go.
6. As a listener, I want my likes collected in a Liked list I can browse anytime, so that I don't lose the good finds.
7. As a listener, I want one tap on a liked item to open that artist/album/song in my music app, so that I can start listening for real.
8. As a listener, I want my taste and likes stored on my device with no sign-up, so that I can start immediately and keep it private.
9. As a listener, I want to edit my seeds while swiping, so that I can redirect the deck when it drifts away from what I want.
10. As a listener, I want the deck to keep dealing while there are good candidates and end quietly when there aren't, so that I'm never shown junk or left staring at a dead app.
11. As a listener, I want to undo my last swipe, so that a mis-tap doesn't cost me a find.
12. As a listener, I want a short wrap-up when a session ends, so that I can see what changed and what I found.
13. As a listener, I want to sort and filter my Liked list by type, so that I can find the album I meant.
14. As a listener, I want my taste to sync across my devices, so that my phone and laptop agree.
15. As a listener, I want the app to explain its failure states inline and let me retry, so that a network blip never looks like a broken product.

## First Version (MVP)

**MVP stories: 1, 2, 3, 4, 5, 6, 7, 8, 10, 15.**

Stories 1–8 are the eight you confirmed. Story 10 (quiet deck-end + "fresh deck") and story 15 (inline error/retry states) are folded in because a deck that runs dry or a catalog blip would otherwise dead-end — both are small, and both are basic safety rather than features.

**Definition of done — the "once, for real" run**

1. Open the app on a phone (installed or in the browser), choose "artists" (or albums, or songs), and add two artists, an album and a couple of genre chips.
2. The deck deals. Sound starts on the first tap and then plays on each following card while it's on. Each card shows large artwork, title, creator, year, one or two tags, play/pause, and "because you like X".
3. Like/skip works by swipe, by button and by arrow key. After a handful of swipes the next cards visibly lean toward what was liked and away from what was skipped; nothing repeats.
4. Every right-swipe is in the Liked list, and one tap opens it in the chosen music app.
5. Reload the page: seeds, likes, taste and settings are all still there. No account was ever asked for.
6. It looks right in dark and light mode, motion is smooth and subtle, and with Reduce Motion on, transitions are instant or a short cross-fade with no card fling.
7. Kill the network mid-session: already-dealt cards still swipe, and the app offers retry instead of looking broken.

**Later, and why**

- 9 — editing seeds mid-session: "start over" from the deck-end state already redirects the deck; in-place editing is polish.
- 11 — undo: useful forgiveness, but the loop can be judged without it.
- 12 — session wrap-up: only meaningful once there is real data to summarise.
- 13 — Liked sorting/filtering: a few dozen items are browsable; filters matter at scale.
- 14 — cross-device sync: needs accounts, which are deliberately absent from the first version.

## Implementation Decisions

- **No backend accounts, no API keys.** The catalog is looked up live from free public music data (Apple's iTunes Search catalog and/or Deezer's public catalog are the intended sources: real artwork, real ~30s preview URLs, genre tags, no auth). Orchestrator to pick and verify exact endpoints, CORS behaviour and rate limits.
- **Recommendation pool = the real catalog.** Any real artist, album or song that the source exposes can surface, including obscure artists reachable from a named seed.
- **Similarity = genre overlap + shared artists**, computed client-side from catalog metadata; no ML model and no server-side recommender.
- **Feedback loop (immediate).** Each like/skip updates a local weight vector over genres and artists. The remaining candidate pool is re-scored on every swipe, so the shift is visible within the next 1–3 cards. A like raises the weight of the card's genres and its creator; a skip lowers the same family. Skips never re-queue the same item. Already-seen items are excluded permanently. The card's "because you like X" line names the seed or liked item that produced its strongest score, so the cause is legible.
- **Samples**: each card carries a catalog preview URL; playback needs a user gesture on the first card in most mobile browsers (autoplay policy) — design the sound affordance around that. Once sound is on, following cards play automatically; a visible sound toggle lets the listener mute.
- **Two reactions only**: like and skip. Implemented as drag-to-swipe, plus visible like/skip buttons and keyboard arrow keys (accessibility, desktop). Undo and stronger signals are deliberately deferred.
- **First-run seeding**: search-as-you-type artist and album pickers (catalog-backed) plus genre chips; at least one seed required before a deck is dealt.
- **Card content**: large artwork, title, creator, year, one or two genre tags, prominent sample play/pause, and a quiet "because you like X" line. Card types: artists, albums, songs — no playlists.
- **Design tokens**: dark-first — near-black canvas (Linear's `#08090a` family), album art as the only saturated colour, translucent blur "glass" chrome, 1px hairline borders, one restrained accent used sparingly, SF-style system font stack (`-apple-system, "SF Pro Text", Inter, system-ui`). Light mode is a paper-white inversion of the same token set.
- **Deck lifecycle**: endless while quality candidates exist; quiet end state with "fresh deck" and "start over / change seeds" (returns to Setup). No session summary in the first version.
- **Errors and edges**: inline messages, never blocking screens. Catalog failure → "Couldn't reach the catalog" + retry, with already-dealt cards still swipeable. Seed that the catalog can't resolve → flagged inline at entry, not silently dropped. Card with no preview → visible "no sample" state, still swipeable. Zero candidates for the chosen type → a quiet explanation plus "change seeds" rather than an empty deck.
- **Persistence**: taste, likes, seeds and settings in `localStorage`; no network call is required to keep state.
- **Opening in the music app**: one setting — Spotify (default), Apple Music or YouTube Music — generating a plain https search/entity link for that service, which the phone may route into the installed app.
- **App map**: Setup (first run: seeds + card type), Discovery (swipe), Liked (list), and a Settings sheet (music app, sound, theme, reset data) reachable from the header.

## Testing Decisions

**Automated**

- **Unit tests** (project's test runner): candidate scoring orders by the taste weight vector; a like raises its genre/creator family in the ranking; a skip demotes it; seen items are never returned again; `localStorage` round-trip for seeds, likes, taste vector and settings (survives reload); reduced-motion preference is read and re-read when it changes; per-service link builders produce the right URLs (Spotify / Apple Music / YouTube Music).
- **One end-to-end test** (Playwright or equivalent) of the core loop with the catalog mocked at the network layer: cold start → add an artist seed → deck deals a card → play/pause the sample → swipe right → the item appears in Liked → reload → the like, seeds and taste are still there. A second pass runs with `prefers-reduced-motion: reduce` and asserts the card does not fling/rotate.
- **Accessibility smoke check**: automated axe pass on Setup, Discovery and Liked; keyboard-only like/skip works.

**Manual (on a real phone)**

- First tap starts the sample on iOS Safari (autoplay policy) and the following cards auto-play while sound is on.
- Install to home screen, standalone launch, safe-area insets, theme-color in both themes.
- Motion feel: card drag/settle, screen transitions, list stagger; then switch on Reduce Motion and confirm everything becomes instant or a short cross-fade with no rotation.
- One tap on a like opens the chosen service's page and routes into the installed app.

**Rules**

- The live catalog is never called in tests; fixtures only. No flaky network tests.
- Tests are not weakened, skipped or deleted to make a build pass. No hard-coded expected recommendation output — assert on the ranking rule, not a fixture-specific answer.
- Any scoring change ships with the test that pins the new behaviour.

## Non-functional Requirements

**Performance.** Interactive in under ~2s on a mid-range phone over 4G. The next card is already in the DOM (prefetch 3–5 candidates ahead) so a swipe settles under ~100ms. Samples start within ~300ms of the gesture. Animations hold 60fps; no layout shift when artwork loads (fixed aspect ratio + placeholder). No blocking spinners — use skeletons or the already-rendered next card.

**Motion.** Motion is part of the product, not decoration: screen transitions, list reveals/stagger, like/skip feedback, and the card settle all animate. 150–350ms, spring-like easing, subtle (no bouncy novelty). All motion must be transform/opacity based (compositor-friendly).

**Reduced motion.** When the OS reports `prefers-reduced-motion: reduce`: no card rotation/fling, no parallax, no staggered reveals, no page slide — replace with instant state changes or a ≤120ms cross-fade. Swipe still works and feedback is still legible (e.g. a label/border change). The setting is followed live, not just at load.

**Theming.** Dark and light mode, following the system by default, with a persisted override (system / dark / light). `theme-color` and PWA manifest colours switch with the theme. Contrast: WCAG AA for text in both themes.

**Accessibility.** Tap targets ≥44px; like/skip available as buttons and ←/→ keys as well as swipes; visible focus rings; icon-only controls have accessible names; artwork has alt text (title — creator); sound state is not conveyed by colour alone; the deck stays usable with a screen reader (card content announced when it changes).

**Privacy.** No accounts, no analytics or third-party trackers, no tracking cookies. All taste data stays in `localStorage` on the device. Network requests go only to the public catalog/preview hosts. A "reset all my data" action exists and asks for confirmation.

**Compatibility.** iOS Safari 16+ and Android Chrome (mobile-first), plus desktop browsers for development. Installable as a PWA: manifest, maskable icons, `display: standalone`, safe-area insets respected on notched phones. Portrait is the target; landscape is not optimised in the first version.

**Language.** English only in the first version.

## Out of Scope

**Deferred to Later (captured as stories 9, 11–14):** editing seeds mid-session (a "start over" that returns to Setup covers redirecting the deck), undo, session wrap-up, sorting/filtering the Liked list, cross-device sync.

**Deliberately out of the product for now:**

- Accounts, sign-in, cloud sync, multi-device taste.
- Any social layer: sharing lists, following other listeners, public profiles, collaborative swiping.
- Playlists as a card type; generating or exporting playlists; writing anything back to a music service (needs OAuth).
- Full-track playback. Only ~30s catalog previews; a card with no preview is still swipeable and says so.
- Recommendations driven by the listener's real listening history (needs a streaming account).
- Notifications, push, daily picks, streaks, gamification.
- Taste analytics/profile screens, charts, insights.
- Bundled or offline catalog; offline-first caching beyond keeping already-dealt cards usable.
- Monetisation, ads, admin, analytics/trackers.
- Languages other than English; RTL.
- Desktop-optimised layout (desktop is for development; the app is phone-shaped).

## Open Questions

- **Which catalog source(s) to use, and whether they work from a browser.** iTunes Search API (no key, real 30s previews, artwork, genres, but no "similar artist" graph and no artist photos) vs Deezer's public API (no key, search + related artists + previews, rate limits ~50 req / 5s, CORS behaviour to verify). Decide in research; the plan is iTunes as the metadata/preview backbone plus a similarity graph from Deezer or from genre + shared-artist co-occurrence. Fallback if CORS blocks: a tiny proxy — but that breaks "no backend", so a CORS-clean source is strongly preferred.
- **Genre taxonomy for the chip picker.** A fixed, curated list of ~25–40 broad genres (mapped to the source's style strings) rather than free text, so weights are comparable.
- **Artist card imagery.** iTunes has no artist photo; pick representative album artwork (highest-resolution release) or a generated typographic tile. Needs a decision before the artist card is designed.
- **Preview coverage.** Some releases/artists have no preview; confirm acceptable coverage and that the "no sample" card still looks deliberate.
- **Primary test device.** Which phone (iOS Safari vs Android Chrome) is the manual-check target — affects autoplay and safe-area testing.
- **Exact motion spec** (durations, spring constants, accent colour) is left to the implementer within the NFR constraints; if two screens disagree visually, the design tokens win.

## Further Notes

Hard constraints stated by the owner:

- Mobile-first web app; can be added to the home screen (PWA).
- Enter liked genres, artists and albums; get recommendations of similar artists, albums or songs — the listener chooses which type.
- Tinder-style swiping on songs / albums / artists; like or skip; feedback improves subsequent recommendations.
- No account in the first version; taste saved on the device.
- UI: very modern and very clean, in the spirit of Apple Music, Linear, Vercel and other big companies. Research those references.
- Smooth, fast, subtle animations are a core requirement on every screen (page transitions, lists, likes). Must respect the phone's "reduce motion" setting.
- Dark and light mode.

Research notes (from the references):

- Apple Music: album art on a black canvas is the whole brand; large artwork, glass/blur chrome for controls, motion used sparingly around the artwork (Liquid Glass direction in 2025 = translucent material + depth, not decoration).
- Linear: near-black `#08090a` surfaces, paper-white type, hairline borders, a single high-signal accent used like a flashlight, precise small type, fast 120–250ms transitions.
- Vercel: monochrome, generous space, geometric precision, minimal ornament; borders and contrast do the work, not shadows.
- Catalog facts: iTunes Search API needs no key and returns artwork + 30s `previewUrl` + `primaryGenreName`; Deezer's public API needs no key and exposes related artists, ~50 req/5s soft limit, 30s previews. Neither gives a full "similar" graph without extra work — hence genre + shared-artist similarity.

How success is measured (owner's own judgement, first version):

- After two weeks, the owner has opened at least three finds from the Liked list in their music app and kept at least one.
- The deck visibly changes direction after swipes, without the owner needing to reason about why.
- Using it feels fast and calm on a phone: no waiting screens, no janky motion, and it looks like a product, not a demo.
- Reduce Motion on and light mode both look intentional, not like broken variants.
