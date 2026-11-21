# Front-end stack for a fast, installable, mobile-first PWA with heavy-but-subtle motion: compare e.g. Vite + React (or Preact/Svelte/Solid) with Motion (framer-motion) / react-spring / @use-gesture vs plain CSS transitions + View Transitions API. Which gives smooth 60fps drag-to-swipe on iOS Safari, live prefers-reduced-motion handling, small bundle (<2s interactive on 4G), and PWA tooling (vite-plugin-pwa / Workbox manifest, maskable icons, theme-color switching)?

Date: 2026-11-21 · Confidence: high

## Recommendation

Vite + React 19 + TypeScript with Motion for React (use `m` + LazyMotion loading `domMax` lazily — full drag/layout API for ~5 KB initial cost) and @use-gesture/react (pointer events, ~5 KB, 10M weekly DLs) driving card transforms directly off MotionValues for guaranteed 60fps drag-to-swipe on iOS Safari, then handing release velocity to a Motion spring for the flyout. Chrome-level screen transitions: CSS transitions + feature-detected View Transitions API (iOS Safari 18+ / Chrome 111+ / Firefox 144+). Accessibility: MotionConfig reducedMotion="user" + useReducedMotion + @media (prefers-reduced-motion) in the CSS conventions. PWA: vite-plugin-pwa 1.3.x (Workbox 7.4, Vite 3–8) with manifest maskable icons + apple-touch-icon + theme-color dark-mode meta pairs; scaffold must include touch-action/overscroll-behavior/100svh/safe-area conventions for iOS. Skip Svelte/Solid/Preact unless the team already lives in them — they cost the Motion React API, which is the single most important library for this product. react-spring works but is the second-tier ecosystem choice. Confidence high on stack shape, medium on exact KB figures (vendor-quoted, gzip, Rollup).

## Findings

RECOMMENDED: Vite + React 19 (TypeScript) + Motion (`m` + LazyMotion domMax, lazy-loaded) + @use-gesture/react for the swipe deck + CSS transitions / View Transitions API as progressive enhancement + vite-plugin-pwa. Svelte 5 / Solid / Preact are viable on size but lose on ecosystem fit for motion tooling (below).

FRAMEWORK COMPARISON
- React 19 + react-dom ≈ 40–45 KB gz initial. Largest of the options but the only first-class host for Motion for React (`motion/react`, formerly framer-motion — the dominant spring/gesture library), plus the largest ecosystem for a swipe-deck UI (dnd, virtualization, state). Motion's native-mode (`motion` vanilla) and mini builds also exist, but `motion/react`'s variants/drag/exit API is React-only.
- Preact (~4.5 KB + compat, ~10 KB) — works with `preact/compat` but Motion is only tested against React; known edge cases with compat shimming on pointer/portal internals. Not worth the risk for a one-screen-deck app.
- Svelte 5 (runes) — smallest compiled output and `transition:` directives are excellent, but no equivalent of Motion's spring-based drag+exit handoff; you'd hand-roll spring physics. Fine choice only if the team already knows Svelte.
- Solid — smallest runtime, but tiniest ecosystem of the four; motion library is `@motionone/solid` (mini engine only, no full drag/layout API).

MOTION/GESTURE LIBRARY (the real decision)
- Motion (motion v14.x on npm as of 2026, MIT, successor of Framer Motion since late 2024, import `motion/react`). Sizes per motion.dev docs: full `motion` component ≈ 43 KB gz (not further tree-shakable); `m` + LazyMotion ≈ ~5 KB initial; feature bundles: `domAnimation` +24 KB (variants, exit, tap/hover), `domMax` +38 KB (adds **drag gestures and layout animations**). For a Tinder-style deck you need domMax; load it via dynamic `import()` after first paint → interactive budget stays small.
- Reduced motion: `<MotionConfig reducedMotion="user">` disables transform/layout animations for prefers-reduced-motion users while keeping opacity/color; `useReducedMotion()` returns the boolean for custom cases (e.g. zeroing parallax). CSS equivalents: `@media (prefers-reduced-motion: reduce)` for all pure-CSS transitions.
- react-spring (@react-spring/web): still maintained — 10.1.2 published 2026-06-24, 11.0.0-beta.1 2026-10-01, ~6.9M weekly npm downloads — but it's the smaller ecosystem; Motion is the default in 2026 hiring/AI-assistant familiarity. No reason to split conventions.
- @use-gesture/react 10.3.1 (pmndrs, MIT, peer dep react ≥16.8, ~5 KB core): ~10.1M weekly downloads, v10 API stable for years. This is the right tool for the drag itself: it's pointer-event tracking only (works fully on iOS Safari 13+ — pointer events are complete there), and you drive `transform: translate/rotate` directly (MotionValue or WAAPI/CSS var) instead of per-frame `setState`, which is what keeps 60fps on iOS. Hand off release velocity to a Motion spring for the flyout. Known iOS requirements to codify in the scaffold: `touch-action: none` on the card (or `pan-y` if vertical scroll must survive), `overscroll-behavior: none` on the scroller (honored in iOS standalone mode 15.4+) to kill rubber-banding, `100svh` for the viewport, meta `viewport-fit=cover` + safe-area insets.
- Plain CSS + View Transitions API: correct for the chrome (tab/nav transitions, card-exit fallbacks). Same-document View Transitions shipped in iOS Safari 18.0 (all current iOS 18–26 supported; caniuse), Chrome 111+, Firefox 144+ — so it's a progressive enhancement behind a `document.startViewTransition` feature check, not the backbone. The drag-to-swipe itself cannot be done with CSS transitions (you need spring physics + pointer tracking), so "plain CSS" alone fails the core requirement.

PWA TOOLING
- vite-plugin-pwa remains the default: v1.3.0 (May 2026) supports Vite 3 through 8, Workbox 7.4.1, generated SW + fully type-safe manifest with `purpose: "maskable"` icons, precache/offline. Watch item: the same maintainer is releasing a successor `@unplugin-pwa/vite` (unified Vite/Webpack/Rspack, docs status Oct 2026) — pin vite-plugin-pwa now, migration should be mechanical later.
- iOS specifics to encode in the scaffold: maskable icons are an Android/launcher feature — iOS uses `apple-touch-icon` (separate 180px asset, no transparency); theme-color via `<meta name="theme-color" media="(prefers-color-scheme: dark)">` pairs for dark-mode switching; push notifications only work for home-screen-installed PWAs on iOS 16.4+ and need a user-gesture permission prompt; Background Sync is unsupported (workbox-background-sync queue is a no-op — implement foreground sync); "Add to Home Screen" surfaced from iOS 17 when a manifest is present.

BUDGET CHECK (<2s interactive on slow 4G): initial JS ≈ React 19 (~40) + use-gesture (~5–13) + app shell (~30–50) + m (~5) ≈ 85–105 KB gz, with the 38 KB domMax chunk lazy-loaded after first card render. That is well under a ~150 KB / 2s slow-4G budget. Rendering cost, not bundle, is the 60fps risk — solved by direct-transform drag updates (above), not by framework choice.

RISKS: (1) Motion major-version churn — v12→v14 moved packages/imports; pin and keep `m`+LazyMotion usage (API surface is stable). (2) iOS Safari standalone-mode quirks (view transitions inside standalone mode, rubber-banding) need device testing in every motion issue. (3) vite-plugin-pwa→unplugin-pwa migration later.

## Sources

- [Motion for React — Reduce bundle size (m, LazyMotion, domAnimation/domMax sizes)](https://motion.dev/docs/react-reduce-bundle-size)
- [Motion for React — LazyMotion docs (strict mode, async feature loading)](https://motion.dev/docs/react-lazy-motion)
- [Motion upgrade guide + MotionConfig reducedMotion="user" patterns](https://terminalskills.io/skills/motion)
- [caniuse — View Transitions API (single-document): iOS Safari 18.0+, Firefox 144+, Chrome 111+](https://caniuse.com/view-transitions)
- [npm registry — motion latest (v14.14.0)](https://registry.npmjs.org/motion/latest)
- [npm registry — @use-gesture/react latest (10.3.1, MIT, pmndrs, react >=16.8 peer)](https://registry.npmjs.org/@use-gesture/react/latest)
- [npm API — @use-gesture/react weekly downloads (10.1M, week to 2026-11-20)](https://api.npmjs.org/downloads/point/last-week/@use-gesture/react)
- [npm registry — @react-spring/web dist-tags + publish times (10.1.2 2026-06-24, 11.0.0-beta.1 2026-10-01)](https://registry.npmjs.org/@react-spring/web)
- [npm API — @react-spring/web weekly downloads (6.9M, week to 2026-11-20)](https://api.npmjs.org/downloads/point/last-week/@react-spring/web)
- [vite-plugin-pwa guide (v1.3.0, May 2026; Vite 3–8; Workbox 7.4.1; onNeedReload; maskable icons)](https://progressivewebapps.com/tooling/vite-pwa/)
- [PWA splash screens & theming (theme-color dark mode, apple-touch-startup-image)](https://progressivewebapps.com/design/splash-screens/)
- [vite-pwa org — Workbox fork repo (native Rolldown/Vite 8 graphs; docs status)](https://github.com/vite-pwa/workbox)
- [Docs status — @unplugin-pwa/vite replacing vite-plugin-pwa (Oct 2026)](https://unplugin-pwa.netlify.app/docs-status)
- [Progressive Web Apps in 2026: iOS push (16.4+, installed PWA only), Background Sync unsupported, maskable icons](https://blog.codercops.com/blog/progressive-web-apps-2026)
- [Framer Motion 2026 guide — full motion ~34-50kb gz, LazyMotion/m sizing (second source)](https://inhaq.com/blog/framer-motion-complete-guide-react-nextjs-developers)
