# Testing and deployment for a static PWA: Playwright with network-layer catalog mocking (page.route) including audio media requests and emulated prefers-reduced-motion, @axe-core/playwright for accessibility, Vitest for units, and which static host (GitHub Pages/Cloudflare Pages/Netlify) suits HTTPS + service worker; can it all run headless in the Linux sandbox (WebKit availability for iOS-like checks)?

Date: 2026-11-21 · Confidence: high

## Recommendation

Adopt the stack: @playwright/test 1.65.x + Vitest 5.x + @axe-core/playwright 4.14.0. Build the test harness issue with: (1) a shared `page.route` fixture that mocks the catalog API and audio tracks — fulfill with `path:`/Buffer fixtures and set context option `serviceWorkers: 'block'` so SW-registered fetches don't bypass interception; (2) an `emulateMedia({ reducedMotion: 'reduce' })` test variant; (3) an AxeBuilder helper pinned to wcag2a/2aa/21a/21aa; (4) a default Chromium-headless-shell project plus an opt-in WebKit project for iOS-like smoke checks (WebKit works headless on Ubuntu/Debian via `npx playwright install --with-deps webkit`). Host on Cloudflare Pages (auto HTTPS on pages.dev + custom domains, root-path serving, unlimited bandwidth, trivial `wrangler pages deploy` in CI), with GitHub Pages as the fallback only if extra-account friction matters — in that case budget for the `/<repo>/` subpath affecting Vite `base`, SW scope, and a `.nojekyll`.

## Findings

TESTING STACK (all verified against current docs, 2026-11)

1. Playwright E2E — package `playwright` / `@playwright/test` 1.65.1 is current (npm, Apache-2.0, Node >= 20). System requirements (playwright.dev/docs/intro): Node 22.x/24.x/26.x, Debian 12/13 and Ubuntu 22.04/24.04/26.04 on x86-64 AND arm64 — all three engines (Chromium, Firefox, WebKit) run headless on Linux. Setup: `npx playwright install --with-deps [browser]` downloads binaries from MS CDN (respect `HTTPS_PROXY`/`PLAYWRIGHT_DOWNLOAD_HOST` if the sandbox egresses via proxy) and apt-installs OS libs (needs root). Chromium ships a separate headless shell — `npx playwright install --only-shell` skips full Chromium in CI. Default binary cache: `~/.cache/ms-playwright`.
   - Network mocking: `page.route(pattern, handler)` / `browserContext.route()`; handler gets `route.fulfill()` with `{ status, headers, contentType, body, path }`. **`body` is typed `string | Buffer` — binary audio (e.g. a .m4a fixture read with `fs.readFileSync`) can be fulfilled directly,** or use `path` to serve a fixture file (contentType inferred from extension). Glob patterns must match the whole URL; RegExp for complex matches (e.g. `/\.(mp3|m4a|ogg)$/`).
   - Critical caveat for a PWA: route interception does NOT cover requests served by a registered service worker. Use the context option `serviceWorkers: 'block'` in test config so the SW never registers and all fetches hit `page.route`. Redirect-awareness: fulfilling with 3xx does not re-invoke the handler (WebKit rejects it) — mock final URLs directly.
   - Reduced motion: `page.emulateMedia({ reducedMotion: 'reduce' | 'no-preference' | null })` (added v1.12) — one line to verify transition/animation code paths respect the media feature.
2. Accessibility — `@axe-core/playwright` 4.14.0 (npm, MPL-2.0, dequelabs/axe-core-npm, published ~Oct 2026, SLSA-provenance-published → actively maintained; peer dep `playwright-core >= 1.0.0`, so fine with 1.65). API: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()` then `expect(results.violations).toEqual([])`. Scan reflects page's current state — must `waitFor` dynamic UI (swipe deck) before scanning; prefer `.disableRules([id])` over `.exclude()` for known issues.
3. Unit tests — Vitest 5.x (5.1.1 current), requires Node >= 22.12 and Vite >= 6.4; it reads `vite.config.*` directly so the app's Vite config (aliases, plugins) works unchanged; monorepo/multi-config via `projects` (workspace config is deprecated). MIT.

HOSTING — all three candidates terminate HTTPS for free, which is the only hard requirement for service-worker registration + manifest install:
- GitHub Pages: `*.github.io` served over HTTPS automatically (default for all sites since 2016); custom domains get auto Let's Encrypt certs + "Enforce HTTPS" toggle, ~few min provisioning. Gotchas: project sites serve at `/<repo>/` subpath → must set Vite `base` and manifest `start_url`/`scope` correctly, and SW scope is `/<repo>/`; Vite assets with leading `_` can be blocked by default Jekyll processing (add `.nojekyll`); deploys via Actions.
- Netlify: instant TLS on `*.netlify.app`, auto Let's Encrypt renewal on custom domains, HTTP/2; `netlify.toml` for headers (Cache-Control on hashed assets, `Service-Worker-Allowed`) and SPA fallbacks. Build minutes are metered on free tier.
- Cloudflare Pages: served at `<project>.pages.dev` over HTTPS; free unlimited bandwidth; direct upload (`npx wrangler pages deploy dist`) or Git integration; 20,000 files / 25 MiB per file per upload — ample for a static PWA as long as catalog audio stays mocked/remote rather than committed.
RECOMMENDATION rationale: Cloudflare Pages and Netlify serve from the site root with zero base-path configuration, which removes the entire GitHub-Pages subpath class of bugs (Vite `base`, SW scope, manifest paths). All three work; the subpath issue is what distinguishes them.

SANDBOX/WEBKIT: Feasible. Headless WebKit for Linux is an official Playwright target on the supported distros (gstreamer and friends come via `install-deps`, which matters for <audio> rendering). Note it is a patched WebKit build, not real iOS Safari, and bundled media codecs vary by OS — so treat WebKit as an iOS-approximation check (smoke + route-emulation tests), not a compatibility guarantee. Keep it as a separate, opt-in `projects` entry in `playwright.config.ts` so a WebKit hiccup doesn't block every issue's acceptance checks; Chromium headless shell is the fast default.

IMPLICATIONS FOR THE SCAFFOLD ISSUES:
- Node >= 22.12 in the image (satisfies Vitest 5 + Playwright); sandbox needs either root for `playwright install-deps` or pre-baked apt libs; if egress is proxied, set `HTTPS_PROXY` before `playwright install`.
- Acceptance checks per feature should standardize on: Vitest units + one Playwright file asserting (a) mocked network served via `page.route` with `serviceWorkers: 'block'`, (b) `reducedMotion: 'reduce'` variant where motion matters, (c) AxeBuilder scan with WCAG 2.1 AA tags in a shared fixture helper, (d) WebKit smoke project.
- Hosting decision should be made at scaffold time because it pins Vite `base`/manifest paths; recommend Cloudflare Pages (root path, unlimited bandwidth, wrangler CI deploy) with GitHub Pages as a zero-extra-account fallback.

## Sources

- [Playwright docs — Network interception / mocking (page.route, route.fulfill, serviceWorkers caveat)](https://playwright.dev/docs/network)
- [Playwright docs — Installation & system requirements (Linux distros, all engines headless)](https://playwright.dev/docs/intro)
- [Playwright docs — Browsers (headless shell, install-deps, media codec variability)](https://playwright.dev/docs/browsers)
- [Playwright docs — page.emulateMedia (reducedMotion: 'reduce')](https://playwright.dev/docs/api/class-page#page-emulate-media)
- [Playwright docs — route.fulfill (body: string | Buffer, path)](https://playwright.dev/docs/api/class-route#route-fulfill)
- [Playwright docs — Accessibility testing (AxeBuilder, withTags)](https://playwright.dev/docs/accessibility-testing)
- [npm registry — @axe-core/playwright 4.14.0 (license, peer deps, publish recency)](https://registry.npmjs.org/@axe-core/playwright/latest)
- [npm registry — playwright 1.65.1](https://registry.npmjs.org/playwright/latest)
- [Vitest — Getting started (v5, Node/Vite requirements, projects)](https://vitest.dev/guide/)
- [GitHub Docs — Securing your GitHub Pages site with HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [Cloudflare Pages — Get started: Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Netlify Docs — HTTPS/SSL](https://docs.netlify.com/domains-https/https-ssl/)
