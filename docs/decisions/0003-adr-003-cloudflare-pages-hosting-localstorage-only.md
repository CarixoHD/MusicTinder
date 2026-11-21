# 0003. ADR-003: Cloudflare Pages hosting, localStorage-only persistence (schema-versioned), keyless deep links (Apple entity, Spotify/YT search URLs)

Date: 2026-11-21 · Status: Accepted

## Context

Deploy target and persistence/ID-mapping choices must be settled at scaffold time because they pin Vite base, manifest paths and the storage schema. PRD requires: installable PWA, no accounts, all taste data on-device, one tap to open a liked item in Spotify (default)/Apple Music/YouTube Music via keyless links. Research verified: GitHub Pages serves under /<repo>/ (base + SW scope bugs), Netlify and Cloudflare Pages both serve at root, and that entity-level linking is keyless for Apple Music (via iTunes API IDs) but would require unmapped IDs for Spotify/YouTube Music.

## Options considered

- **Cloudflare Pages, root path**: HTTPS at root, unlimited free bandwidth, wrangler deploy; zero base-path bug class.
- **GitHub Pages**: Subpath /<repo>/ serving forces Vite base + SW scope + start_url changes and .nojekyll.
- **Netlify**: Root-path HTTPS too; metered build minutes on the free tier.

## Decision

Static SPA served from a site root on Cloudflare Pages (`wrangler pages deploy dist`); HTTPS root-path serving satisfies service-worker/manifest install without base-path configuration. All persistent state in localStorage under one namespaced, versioned root (schema v1 + migrate()); the catalog cache lives in the same localStorage with TTL/LRU caps rather than IndexedDB, accepting re-lookup cost on eviction because liked-card snapshots make the Liked list render entirely offline. Deep links: Apple Music gets exact entity URLs from iTunes trackViewUrl/collectionViewUrl (&uo=4 stripped); Spotify and YouTube Music get registered universal-link search URLs (open.spotify.com/search/…, music.youtube.com/search?q=…) — entity IDs are not mapped, deferring two whole ID-resolution APIs the PRD explicitly permits skipping.

## Rationale

Root-path serving removes an entire class of PWA bugs (manifest scope, SW registration, asset paths) at zero cost, and Cloudflare's free tier has unmetered bandwidth for a static bundle. GitHub Pages was rejected purely on the subpath risk it adds to a PWA whose install story is a definition-of-done item. Apple Music entity links are free — our catalog IS iTunes — so exact links are taken where they exist; Spotify/YouTube Music search links avoid two extra services and failure modes the PRD explicitly allows avoiding.

## Sources

- [Research: testing and deployment for a static PWA](docs/research/testing-and-deployment-for-a-static-pwa-playwright.md)
- [Research: deep links into music apps](docs/research/deep-links-into-music-apps-without-api-keys-exact-.md)
