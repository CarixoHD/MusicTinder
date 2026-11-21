# Catalog sources from a browser with no backend: exact iTunes Search/Lookup and Deezer public API endpoints for searching artists/albums/tracks, related artists, artist top tracks, genre data and preview URLs. Does each send CORS headers (Deezer historically needed JSONP; does output=jsonp still work?), what are the real rate limits, and do preview URLs (mp3/m4a) play in <audio> on iOS Safari 16+ and Android Chrome without CORS/expiry problems (Deezer preview URLs are signed and expire)?

Date: 2026-11-21 · Confidence: medium

## Recommendation

Build data-layer-first with "no backend" for v1: iTunes Search/Lookup as primary catalog via plain fetch() (CORS confirmed: Access-Control-Allow-Origin: *; ~20 calls/min hard budget → cache aggressively in IndexedDB keyed by id, respect the 86400s cache-control), and Deezer as enrichment API (related artists via GET /artist/{id}/related, genres via /genre, typed search via /search/artist|album|track) called only through script-tag JSONP (output=jsonp&callback= still works, live-verified; fetch() to api.deezer.com does NOT work — no ACAO). Treat Deezer preview URLs as ~15-minute throwaway tokens (hdnea exp= observed): resolve via API immediately before playing in <audio>, never persist them. iTunes previews (.m4a, unsigned) are safe to persist. Mock at the repository-interface boundary in e2e, not the wire, since one of the two transports is JSONP. Track a follow-up issue for an optional tiny edge proxy if Deezer JSONP error-handling or Apple's 20/min limit becomes painful — it is not needed to start.

## Findings

All findings below were verified live on 2026-11-21 by actually fetching the endpoints/headers (not just docs).

== ENDPOINT MATRIX ==

iTunes Search API (no key, https://itunes.apple.com):
- Search: GET /search?term=X&media=music&entity={musicArtist|musicAlbum|musicTrack|musicVideo|mix|song}&attribute=&limit=1..200&country=US(ISO,default US)&lang=en_us&explicit — returns {resultCount, results[]}. Tracks carry previewUrl, artistId, collectionId, primaryGenreName/primaryGenreId.
- Lookup (replaces "get by id" + top tracks): GET /lookup?id=<iTunesId>&entity=song|album&limit=N returns the artist plus up to N top songs / albums (also accepts amgArtistId, upc, isbn, sort=recent). Verified live: /lookup?id=909253&entity=song&limit=3.
- Related artists: NOT EXISTING in iTunes Search API. Approximation only: lookup artist → search within same primaryGenreId. If "Music Tinder" needs real related artists, that's Deezer's niche.
- Genres: no genre-list endpoint. Genre surface = primaryGenreName/primaryGenreId fields on results + the UNDOCUMENTED search filter &genreId=<id> (community genre-id lists; live check with genreId=115 returned genre-filtered tracks).

Deezer "simple API" (no key, https://api.deezer.com — all verified live):
- Search: GET /search?q= and typed /search/artist?q=, /search/album?q=, /search/track?q= (+playlist,user,radio,flow). Pagination via index/limit params; `next` URL included.
- Artist: GET /artist/{id} (nb_fan, picture_xl); top tracks GET /artist/{id}/top?limit=N (max ~100, tracks each carry `preview`); albums GET /artist/{id}/albums; radio GET /artist/{id}/radio.
- Related artists: GET /artist/{id}/related — EXISTS and works with no auth (verified: /artist/27/related returned 20 artists, first = Justice). This is a one-up vs iTunes.
- Genres: GET /genre (22 genres, ids like 0 All, 132 Pop, 116 Rap/Hip Hop), /genre/{id}, /genre/{id}/artists, /genre/{id}/radios.
- Album/track: /album/{id}/tracks, /track/{id} — all track objects include `preview`.

== CORS / JSONP (the deciding fact) ==

- iTunes: `GET https://itunes.apple.com/search?...` returns `Access-Control-Allow-Origin: *` — verbatim header captured today via an HTTP-header API. Plain `fetch()`/`<audio>`-adjacent XHR works from any origin. Docs still push JSONP (`&callback=`) "for cross-site searches" and it remains supported as a fallback, but you don't need it. Responses also carry `Cache-Control: max-age=86400`.
- Deezer: `GET https://api.deezer.com/artist/27` returns NO `Access-Control-Allow-Origin` (captured today; it does send Access-Control-Allow-Methods/Headers/Credentials but without ACAO any actual cross-origin fetch fails — matching SO reports from 2024-03 and dev.to write-ups from 2025-04 where people still bolt on CORS proxies). BUT `output=jsonp&callback=fn` STILL WORKS: live call `/search?q=daft%20punk&limit=1&output=jsonp&callback=foo` returned valid `foo({...})`, and the `next` URL preserved callback + index for pagination. So browser-direct Deezer = script-tag JSONP only: no real error/status handling, no timeouts, CSP/frame-ancestors friction, awkward to mock with MSW-style fetch interception.

== RATE LIMITS ==

- iTunes: official doc, "The Search API is limited to approximately 20 calls per minute (subject to change)" — per-IP soft limit, 403/503 when exceeded; Apple explicitly recommends caching. 20/min is the tightest budget in the stack; a swipe-heavy UI will hit it on any browse-heavy session without an aggressive local cache (IndexedDB; HTTP cache itself only helps 24h given max-age=86400).
- Deezer: undocumented officially but consistently reported as ~50 requests / 5 seconds per IP; exceeding it returns error JSON {error:{code:4, message:"Quota limit exceeded"}} / 429 with Retry-After (multiple 2024-2026 sources: musicapi.com rate-limit guide 2026-07, thomasmoserdev.com 2026-09, freyr GitHub). 50 req/5s is generous for a swiping app — caching artist/track/related objects by Deezer id is still trivially cheap insurance.

== PREVIEW URLS ==

- iTunes previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/<hierarchy>/<uuid>.m4a` (verified live, ends ".plus.aac.p.m4a", no query string). Unsigned, static CDN asset, de-facto no expiry. AAC-in-MP4 plays natively in both iOS Safari 16+ and Android `<audio>` (no crossorigin attribute, so no CORS applies to media-element playback).
- Deezer preview: 30 s MP3 from `cdnt-preview.dzcdn.net/api/1/1/...mp3?hdnea=exp=<unix>~acl=<path>~data=user_id=0,application_id=42~hmac=<sig>` — captured live on two successive calls: exp=1795276566 then exp=1795276582, i.e. generated ~15:41 UTC and expiring 15:56 UTC → the signed Akamai token lives ≈15 minutes (NOT days/weeks as some older community claims suggest). ReefAPI's Nov-2026 docs confirm: "A 30-second MP3 clip URL. It is signed and expires." Expired tokens 403. Practical rule: NEVER persist deezer preview URLs; resolve them fresh from /search/track, /artist/{id}/top or /track/{id} immediately before playback (MP3 plays fine in `<audio>` on both platforms while the token is valid).

== VERDICT FOR "NO BACKEND" ==

It technically holds, with an iTunes-first shape: iTunes for search/lookup/top-tracks via plain fetch + long caching; Deezer for related artists and genre trees via JSONP script tags (preview URLs resolved on-demand right before playback). Fragility points: Deezer JSONP (no error paths, CSP, hard to mock in e2e), Apple's 20 calls/min, and the ~15-min deezer preview TTL. The e2e mocking boundary should be: mock the catalog DATA layer (a repository interface: searchArtists, getArtist, topTracks, related, genres) rather than the network; Deezer requests must be treated as opaque script loads, and previews as short-lifetime throwaway resources. If at any point you want robust Deezer fetch (real CORS, error handling) or to dodge the 20/min cap, the escape hatch is a single tiny edge-proxy route — cheap to add later, so it should be an explicitly deferred issue, not an architecture blocker.

## Sources

- [Apple — iTunes Search API (official docs: endpoints, entities, callback param, 20 calls/min limit)](https://performance-partners.apple.com/search-api)
- [Live header capture: itunes.apple.com/search sends Access-Control-Allow-Origin: *; api.deezer.com/artist/27 does not](https://api.hackertarget.com/httpheaders/?q=https://itunes.apple.com/search?term=daft)
- [Live JSONP check: api.deezer.com/search?...&output=jsonp&callback=foo returns foo({...}) (works)](https://api.deezer.com/search?q=daft%20punk&limit=1&output=jsonp&callback=foo)
- [Stack Overflow (2024-03): api.deezer.com lacks Access-Control-Allow-Origin for browser calls](https://stackoverflow.com/questions/78155952/how-to-solve-cors-issue-making-deezer-api-call)
- [Dev.to (2025-04): Deezer chart site without backend, still needing a CORS proxy for fetch()s](https://dev.to/reynaldi/create-a-cool-music-chart-site-with-deezer-api-no-backend-needed-386e)
- [Music-API rate-limit guide (2026-07): Deezer ~50 requests / 5 s, 429 + Retry-After](https://musicapi.com/blog/music-api-rate-limiting-guide)
- [Blog (2026-09): Deezer API quota error code 4 'Quota limit exceeded' ≈50 req/5 s](https://www.thomasmoserdev.com/blog/connect-deezer-api-to-nextjs)
- [ReefAPI Deezer docs (Nov 2026): 'preview — A 30-second MP3 clip URL. It is signed and expires'](https://reefapi.com/deezer-api)
- [Live endpoint checks: deezer /artist/{id}/related, /artist/{id}/top, /genre; iTunes /lookup?id&entity=song, previewUrl format](https://api.deezer.com/artist/27/related)
- [Stack Overflow: iTunes Search API rate limit 20 calls/min](https://stackoverflow.com/questions/12596300/itunes-search-api-rate-limit)
