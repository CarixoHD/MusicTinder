# 0002. ADR-002: Catalog = iTunes fetch backbone + Deezer JSONP similarity adapter, previews from iTunes only

Date: 2026-11-21 · Status: Accepted

## Context

The PRD requires a keyless, no-backend catalog with real artwork, ~30 s previews and genre tags, browsable from a phone browser; open question "which catalog source(s) and do they work from a browser". Live research (2026-11-21) verified: iTunes Search API sends ACAO:* but is limited to ~20 calls/min; Deezer sends no ACAO for fetch but `output=jsonp` still works and exposes /artist/{id}/related + artist pictures; Deezer preview URLs are signed and expire ≈15 minutes; iTunes previews are unsigned static CDN assets; neither API offers a full similarity graph except Deezer related-artists.

## Options considered

- **iTunes-first + Deezer JSONP for related artists/pictures**: CORS-clean fetch backbone; real similarity spine; previews only from iTunes; JSONP quarantined in one module.
- **iTunes-only (genre + shared-artist co-occurrence similarity)**: One transport, zero fragile JSONP — but no related-artist graph; deck drift visible only via genres; weakest 'visibly improves' contract.
- **Deezer-first (related + radio)**: Best similarity API and embedded imagery, but all previews are throwaway signed tokens; JSONP on the hot path for metadata.
- **Tiny backend proxy from day one**: Robust fetch/JSON conversion and CORS for both sources — but breaks the PRD's explicit 'no backend, no accounts' decision.

## Decision

iTunes Search/Lookup API is the metadata/preview backbone: plain `fetch()` (verified `Access-Control-Allow-Origin: *`), 24 h localStorage cache honouring `max-age=86400`, supplying seed search, album lookups, genre strings/ids and preview URLs (unsigned stable .m4a — the only previews persisted). Deezer public API is the similarity + imagery adapter over a single quarantined JSONP script-tag transport (`output=jsonp&callback` — fetch is blocked, no ACAO), supplying `/artist/{id}/related` for the candidate spine and artist `picture_medium/big` for artist cards. Deezer signed preview URLs (~15 min TTL) are resolved on demand at play time and never persisted; cards prefer iTunes previews. An iTunes token bucket (~17 req/min) serialises lookups; on cool-down the deck continues with un-enriched cards. Candidate expansion: related artists → artists; artist top-tracks + album lookups → songs/albums; no genre-pool reliance (geo-noisy). A tiny edge proxy is the recorded escape hatch, deliberately deferred.

## Rationale

The related-artist graph is the single strongest contributor to the PRD's core success metric ('the deck visibly leans toward what was liked within 1–3 cards'), so iTunes-only was rejected. Deezer-first was rejected because every card preview would depend on a ~15-minute signed token resolved at play time, and JSONP would be on the metadata hot path. A proxy was rejected as it contradicts a hard PRD constraint and can be added later without re-architecture thanks to the transport seam. The chosen split puts the fragile transport off the hot-path and confines it to one module while still carrying the similarity spine, and the ~20 req/min iTunes limit is handled by a rate-budgeted prefetcher rather than hoped away.

## Sources

- [Research: catalog sources, CORS, JSONP, rate limits, preview TTLs](docs/research/catalog-sources-from-a-browser-with-no-backend-exa.md)
- [Apple Search API docs](https://performance-partners.apple.com/search-api)
- [Research: candidate generation and request budget](docs/research/candidate-generation-and-similarity-from-what-thos.md)
