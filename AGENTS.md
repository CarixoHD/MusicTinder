# AGENTS.md — operating manual

Music Tinder: no-backend mobile-first swipe PWA. Read `docs/ARCHITECTURE.md`
(module map, data model, flows) and `CODING_STANDARDS.md` before your first change.
The PRD is `docs/PRD.md`.

## Layout

```
src/catalog/    the ONLY module that touches the network (iTunes fetch, Deezer JSONP, cache, rate budget)
src/chips.ts    curated genre chips + normalizeGenre() (pure)
src/taste/      pure Rocchio-style recommender (no I/O, no time dependence — elapsedMs passed in)
src/deck/       hot path: pool, seen-exclusion, ≥5-card prefetch, synchronous swipe commit
src/audio/      PreviewPlayer: 2 reused <audio> A/B buffer, first-gesture unlock
src/links/      pure deep-link builders (spotify/apple/ytmusic)
src/store/      one zustand store, persist → localStorage mt:v1.* (schema versioned)
src/ui/         screens, theme, transitions, tokens; no logic that belongs in deck/taste
src/testkit/    FakeCatalog + Playwright fixtures; the live catalog is NEVER hit in tests
```

Dependency rule: `ui → deck → {taste, catalog, audio, links}`; all persistence
through `store`. Shared types in `src/types.ts` only.

## Pinned dependencies (verified together 2026-11-21 — do not guess, do not bump majors)

react/react-dom 19.3.1 · motion 14.14.0 · @use-gesture/react 10.3.1 · zustand 5.1.0 ·
vite 8.3.8 · @vitejs/plugin-react 6.3.0 · vite-plugin-pwa 2.0.0 · typescript 5.9.3 ·
vitest 5.1.1 · jsdom 31.0.1 · @playwright/test 1.65.1 · @axe-core/playwright 4.14.0 ·
eslint 9.39.1 · typescript-eslint 8.46.4 · eslint-plugin-react-hooks 7.0.1 ·
Node ≥ 22.12. package.json **must** keep `"type": "module"` (vite 8/rolldown).

## Commands

| Purpose | Command |
| --- | --- |
| Install | `npm install` |
| Dev server | `npm run dev` (honours `$PORT`, binds 0.0.0.0 when `HOST=0.0.0.0`) |
| Unit tests (all) | `npm run test` |
| One test file | `npx vitest run src/taste/taste.test.ts` |
| Only affected tests | `npx vitest run --changed main` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| E2E | `npm run test:e2e` (first time: `npm run test:e2e:install`) |
| Production build | `npm run build` → `dist/` (+ service worker) |

Typecheck, lint and tests run in parallel — none may depend on another's output.
E2E uses Chromium headless-shell (pre-baked in the sandbox); WebKit is an opt-in
project, not part of acceptance.

## Conventions

- **Hot-path rule**: a swipe/reaction is one synchronous commit (taste + store +
  next card). No `await` on the commit path; network work is fire-and-forget.
  Drag transforms write to MotionValues, never per-frame `setState`.
- **Motion**: only `m` components with `LazyMotion features={domMax} strict`;
  transform/opacity only; 150–350 ms; `MotionConfig reducedMotion="user"` at root;
  every animation has a reduced-motion behaviour (instant or ≤120 ms cross-fade).
- **Network**: only inside `src/catalog/`. iTunes via fetch; Deezer **JSONP only**
  (`deezerJsonp.ts` is the only transport of its kind). Cache TTL 24 h; iTunes
  budget ~17 req/min via `budget.ts`. Never persist Deezer preview URLs.
- **State**: everything user-owned goes through the store + localStorage
  (`mt:v1.*`, schema version + `migrate()`). Pool/current card are never persisted.
- **Tests**: fixtures only, no live catalog; assert ranking rules, not fixture
  answers; never weaken/skip/delete tests; a scoring change ships with its test.
- TypeScript strict; no `any`; errors are typed and handled inline (story 15:
  failures explain themselves and offer retry — never a blocking screen).
- UI copy: plain verbs, sentence case, user-perspective ("Save changes", not "Submit").

## For testers

- Run `npm run dev`, open the printed URL from your phone on the same network
  (`HOST=0.0.0.0 PORT=5173 npm run dev` from another machine).
- First run opens **Setup**: type an artist/album name and pick from the
  search results, or tap genre chips. Add at least one seed, pick Artists/Albums/
  Songs → the deck deals. First tap enables sound (browser autoplay rule); a tap
  on the sound icon re-enables it any time.
- No account: state lives in that browser only. **Reset data** (Settings sheet)
  wipes everything. To start completely clean, open the app in an incognito
  profile or clear site data.
- For scripted testers: open with `?seedDemo=1` to pre-populate two artist seeds,
  one album seed, some genre chips and a few likes (fixture catalog data), then
  go straight to the Discovery deck.
- Data in automated e2e starts from fresh context per test (`serviceWorkers:
  'block'` is set there, so PWA caching never hides the network mocks).

## Known sharp edges

- iOS Safari: first play needs a gesture (sticky activation covers the session —
  but re-unlocks per cold launch in standalone PWA mode).
- iTunes ~20 req/min: refill runs off the hot path every ~8–10 swipes; on
  cool-down the deck must keep dealing un-enriched cards, never stall silently.
- Vite 8 uses rolldown: keep `"type": "module"`, and use `.mjs`/`type: module`
  style configs (no CJS in vite.config).
