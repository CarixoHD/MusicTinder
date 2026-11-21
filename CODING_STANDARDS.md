# CODING_STANDARDS.md — what reviewers enforce

## Naming

- Files: kebab-case (`taste-weights.ts`) inside `src/taste/`, `src/deck/`, etc.;
  React components PascalCase (`Card.tsx`, `LikedScreen.tsx`). React component
  files in `src/ui/screens/` may be `Discovery.tsx`-style; hooks `useX.ts`.
- One exported concept per module. Name the domain, not the mechanism:
  `commitReaction`, not `handleClickAndSaveAndRerank`.
- Booleans read as predicates: `isSoundOn`, `hasPreview`, `canDeal`.
- Test names state the rule being pinned: "a like raises the card's chips in the
  ranking", "a seen item is never returned again".

## TypeScript

- `strict` always; no `any`, no `as` casts except at the two known seams
  (JSONP payload boundary, persisted-state read) — with a comment why.
- Shared domain types live in `src/types.ts`. No module-local duplicates of
  `Card`, `Chip`, `Reaction`, `Seed`, `TasteWeights`.
- Discriminated unions over optional-field soup (`kind: 'artist' | 'album' | 'song'`).
- No default exports except React screen components and vite/eslint configs.

## Error handling (story 15 is a rule, not a story)

- Every fallible operation has a named failure kind the UI can render:
  `CatalogError { kind: 'offline' | 'rate-limit' | 'unresolved-seed' }`,
  audio error codes from the `PreviewPlayer` taxonomy.
- No silent catch. `catch` either retries with backoff, flags a status, or
  degrades explicitly — never swallows.
- The deck never waits on the network: un-enriched/fallback cards are first-class
  states, not bugs. "No sample" cards stay swipeable. Refill failure →
  `stalled` + retry; dealt cards keep working offline.
- User-facing errors explain what happened and what to do, in plain English,
  inline — never a blocking overlay, never a raw error object.

## The hot path (reviewed line by line on any `deck/` change)

- `deck.commit()` and `taste.applyFeedback()` must stay synchronous and pure of
  I/O; the store write is the only side effect. No `await`, no `setTimeout`, no
  fetch on the commit path.
- Drag rendering writes to MotionValues only. A `useEffect`-per-frame or
  `setState`-per-frame drag change is rejected.
- New network calls must go through `src/catalog/` and obey `budget.ts`.
  Nothing else may call `fetch` — enforced by review.

## Motion & accessibility

- Transform/opacity only; durations 150–350 ms; no bouncy novelty.
- Every animation states its reduced-motion behaviour (code comment + implementation):
  instant state change or ≤120 ms cross-fade. `useReducedMotion()`/`matchMedia`
  live re-read — never a load-time-only capture.
- Tap targets ≥ 44 px. Icon-only controls have `aria-label`s. Artwork alt text is
  `"title — creator"`. Like/skip available as buttons, swipes, and ←/→ keys, with
  visible focus rings.
- Card content changes are announced (`aria-live`) for screen readers; sound state
  is never conveyed by colour alone.
- Contrast: WCAG AA in dark **and** light themes. Never the accent colour
  against itself at low contrast.

## Testing rules

- Fixtures only; the live catalog is never called in tests (PRD hard rule).
- Assert ranking **rules**, not fixture-specific outputs. Hard-coding an expected
  recommendation is rejected.
- Do not weaken, skip, or delete tests to make a build pass (`xit`, `skipIf`,
  deleted assertions). Fix the product or argue the change.
- Any scoring / deck-behaviour change ships in the same PR with the test that pins it.
- New user-visible interactions get: unit coverage for state logic, e2e for the
  journey, and an axe-scan pass on the touched screens.
- Persisted-state changes bump the schema version and add a `migrate()` case with
  a round-trip test.

## Security & privacy

- No analytics, no trackers, no third-party scripts from the app itself.
- All requests go to `itunes.apple.com`, `api.deezer.com`, and the catalog CDN
  hosts — nothing else, without an ADR.
- Never persist: Deezer preview URLs, any user identifier, anything not listed in
  the data model. `resetAll()` clears every `mt:v1.*` key and asks first.
- No `dangerouslySetInnerHTML`; catalog strings are rendered as text.
- Links are built by `src/links/` and validated as https before `window.open`.
  No `eval`, no `Function(`, no dynamic `import()` of non-bundled URLs.

## Styling

- Design tokens from `src/ui/tokens.css` (CSS custom properties) — no raw hex,
  px font sizes, or ad-hoc shadows in components. The token layer is the only
  place colours/spacing exist.
- Plain CSS (custom properties + component classes). No CSS-in-JS, no Tailwind.
  Fixed aspect-ratio artwork containers + placeholder — no layout shift.
- `100svh` viewport; `viewport-fit=cover`; safe-area insets on all edge chrome;
  `touch-action` and `overscroll-behavior` set per the deck's needs (AGENTS.md).
