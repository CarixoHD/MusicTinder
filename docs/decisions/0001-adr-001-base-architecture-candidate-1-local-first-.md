# 0001. ADR-001: Base architecture — Candidate 1 (local-first, one Catalog seam) with Candidate 3's hot-path commit pipeline and Candidate 2's transport/testkit seams

Date: 2026-11-21 · Status: Accepted

## Context

Three architecture candidates were proposed for Music Tinder, a no-backend, mobile-first swipe PWA whose whole product is one hot loop (swipe → taste update → next card) plus setup/liked screens, with iTunes Search + Deezer public API as the catalog and localStorage for all state. Candidate 1 optimises for fewest moving parts (Catalog interface, pure recommender, zustand store, no router). Candidate 2 optimises for deferred-growth seams (five ports: catalog, transport, recommender, taste, persistence, audio, deeplinks, deck) and a first-class testkit. Candidate 3 optimises the swipe hot path (synchronous commit pipeline, 5-card hot ring, additive invertible taste deltas).

## Options considered

- **Candidate 1 — Local-first, fewest moving parts**: One Catalog interface with 2 adapters (iTunes fetch, Deezer JSONP), pure Rocchio recommender, zustand+persist/localStorage, no router, no IndexedDB. Cleanest v1; hot-path and growth seams weaker.
- **Candidate 2 — Five-port hexagon**: Ports + one adapter for every deferred-growth seam (catalog, transport, recommender, persistence, audio, deeplinks) plus first-class testkit. Best long-term extension, most ceremony for a solo v1.
- **Candidate 3 — Swipe-first hot ring**: Everything centred on a synchronous <5ms swipe commit pipeline and a ≥5-card prefetched queue; IndexedDB catalog cache; additive invertible taste deltas. Best loop performance and forgiveness hooks; two storage systems.

## Decision

Adopt Candidate 1 as the base: one `Catalog` interface (iTunes fetch adapter for search/lookup/previews/artwork; Deezer adapter for related-artists and artist pictures over a quarantined JSONP transport), one pure Rocchio-style taste module, zustand+persist on localStorage (no IndexedDB, no router — 3 screens + sheet), plain CSS custom-property tokens, static bundle on Cloudflare Pages. Merge in Candidate 3's swipe-loop discipline: every user action is one synchronous commit (<5 ms: taste update + pool re-rank + next-card promote + one localStorage write) off which all network work is fire-and-forget; a ≥5-card prefetched hot queue; an iTunes token bucket (~17 req/min) with cool-down degradation to un-enriched cards; additive, invertible TasteDeltas (stored per swipe) so undo (story 11) and session wrap-up (story 12) later read existing data without refactor. Keep only Candidate 2's port that earns its keep — the catalog transport seam (fetch vs JSONP, the proxy escape hatch) — plus its first-class testkit (FakeCatalog + Playwright route fixtures with serviceWorkers:'block'). Swipe UI, motion and persistence stay concrete, not ported: no second implementation is plausible there.

## Rationale

The PRD's success metric is that the deck visibly improves within the next 1–3 cards and feels fast and calm on a phone — that is the hot path, so Candidate 3's commit discipline is load-bearing and must be in the foundation, not retrofitted. Candidate 1's interface inventory is exactly the MVP scope (nothing speculative), with the riskiest moving part (Deezer JSONP) correctly quarantined behind one interface so a later edge-proxy is a one-module swap. Candidate 2's five ports are mostly speculative for v1 — but two of its ideas are kept because they pay: the transport seam (the deferred proxy issue lives there) and the testkit as a module (e2e must mock catalog data, never hit the live catalog). Verified version set (installed and built in the sandbox 2026-11-21): react/react-dom 19.3.1, motion 14.14.0 (m+LazyMotion domMax, TSC-verified), @use-gesture/react 10.3.1, zustand 5.1.0, vite 8.3.8 (+\"type\":\"module\", rolldown), vite-plugin-pwa 2.0.0 (build + sw.js generated), typescript 5.9.3, vitest 5.1.1 (+jsdom 31.0.1), @playwright/test 1.65.1 (chromium_headless_shell-1252 pre-baked), @axe-core/playwright 4.14.0, eslint 9.39.1 + typescript-eslint 8.46.4 + eslint-plugin-react-hooks 7.0.1.

## Sources

- [PRD — Music Tinder](docs/PRD.md)
- [Research: front-end stack (Motion + use-gesture + vite-plugin-pwa)](docs/research/front-end-stack-for-a-fast-installable-mobile-firs.md)
- [Research: catalog sources, CORS, JSONP, rate limits, preview TTLs](docs/research/catalog-sources-from-a-browser-with-no-backend-exa.md)
- [Research: candidate generation, Rocchio relevance feedback, imagery](docs/research/candidate-generation-and-similarity-from-what-thos.md)
- [Research: audio unlock, double-buffer, error handling](docs/research/audio-playback-under-mobile-autoplay-policies-how-.md)
- [Research: Playwright/axe/vitest toolchain and hosting](docs/research/testing-and-deployment-for-a-static-pwa-playwright.md)
