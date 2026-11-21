# For a no-backend browser PWA (static site, no secrets, called directly from the browser), which public music APIs give the best search-as-you-type for ARTISTS and ALBUMS, better than iTunes Search (≈20 req/min per IP, 403/429 when exceeded)? Verify live where possible for each candidate: (1) Deezer /search/artist and /search/album via JSONP (rate ≈50 req/5s?, result quality, nb_fan, pictures, duplicate profiles); (2) MusicBrainz WS/2 artist and release-group search (CORS headers from a browser? 1 req/s rule, User-Agent requirement when browsers can't set UA, result quality, Cover Art Archive for album art); (3) Last.fm artist.search / album.search / artist.getSimilar (needs an API key — is a public key in a static client acceptable per their ToS? CORS? rate limits); (4) ListenBrainz/MusicBrainz similar-artists (labs API) CORS and limits; (5) Spotify Web API (client-credentials needs a secret; PKCE needs user login; is search possible keyless? Note Spotify's Nov 2024 deprecation of related-artists/recommendations for new apps); (6) TheAudioDB, Discogs (token?) briefly. For each: CORS yes/no, auth, rate limit, latency, quality for obscure artists (e.g. 'Carpenter Brut', 'Perturbator', 'Kavinsky'), and whether results map to iTunes ids (needed for previews) or Deezer ids (needed for related artists). Recommend the best primary source for artist search and for album search given our stack (iTunes for previews/albums, Deezer JSONP for related artists).

Date: 2026-11-21 · Confidence: high

## Recommendation

Make Deezer JSONP `/search/artist` (and `/search/album`) the primary search source, de-duped by max nb_fan; keep iTunes secondary for previews/albums; use MusicBrainz (≤1 req/s) only for enrichment; skip Last.fm/Spotify/TheAudioDB/Discogs for this stack.

## Findings

All findings below were probed live on 2026-11-21 unless marked (docs). None of the candidate APIs returns iTunes ids directly; all require a canonical-name re-lookup into iTunes for previews (cheap, low-volume).

1) DEEZER (api.deezer.com) — RECOMMENDED artist-search primary.
- Auth: none. JSONP verified live: `/search/artist?q=carpenter%20brut&output=jsonp&callback=cb` returned `cb({...})`. Plain JSON also works keyless, and community evidence (2016+ onward) says `Access-Control-Allow-Origin: *` is sent on public endpoints — JSONP alone is sufficient for a static site (CORS header itself not re-verified by my tooling).
- Rate limit: no official documented number on Deezer docs; community-measured ≈50 req/5s (=10 req/s), ~30x iTunes' ~20 req/min. My burst of live queries produced zero errors.
- Quality: good but MUST de-dupe. Carpenter Brut: total 5 hits, main profile id 4346304 has 26 albums / 83,999 fans — but a duplicate/idle profile (id 414858642, 6 fans) ranked #1 by relevance. Kavinsky: 91 hits; real profile id 13358 has 500,033 fans vs a dupe with 132 fans also ranked above it. Perturbator: clean single profile (id 4740810, 61,908 fans, 23 albums). Rule that works: pick max(nb_fan) (or nb_album as tiebreak); nb_fan is also a natural "popularity" signal for the tinder UI. Returns artist id (feeds Deezer /artist/{id}/related for the existing related-artists flow), picture_url 500x500, nb_fan.
- `/search/album?q=perturbator+uncanny+valley` verified: returned "The Uncanny Valley" + Expansion edition with album ids and cover art. Good fallback/alternative for albums.

2) MUSICBRAINZ WS/2 — best data, worst rate limit.
- CORS: yes — community (jesus2099, docdem) demonstrated cross-domain XHR receiving `Access-Control-Allow-Origin: *`; JSONP officially declined (MBS-4057). No key.
- Rate limit: live-verified the hard side: sequential probes got repeated `503 Service Unavailable` with `Retry-After: 1`. Rate-limiting doc: 1 req/s per IP (at 4 req/s, 100% of requests get 503); browsers can't set a meaningful User-Agent (their guidance wants `App/1.0 (email)`), and anonymous requests only survive inside the 1 req/s IP budget. Shared office/NAT IPs will collide across users.
- Quality: excellent — live artist search for "carpenter brut": count 873, top hit Carpenter Brut score 100, MBID 303abdee-ffca-4685-a582-6aaaefd81b01. Release-group search + Cover Art Archive can supply album art, but CAA coverage is patchy for niche releases and art URLs need extra lookups. No iTunes/Deezer ids in responses; you'd map by name.

3) LAST.FM — possible but ToS-murky for a static site.
- Auth: API key required (free for non-commercial; commercial → partners@last.fm). JSONP is documented (verified in /api/rest: `format=json` + optional `callback` wraps response, MIME text/javascript) — so CORS is not required.
- Terms (verified /api/tos): no numeric rate limit stated — "Last.fm sets and enforces limits... in our sole discretion" (4.4); 2.7 says you may "only give public access to pages using Last.fm's web services that have been previously approved by Last.fm in writing"; non-commercial only without an agreement (3.1). A public static client shipping the key is not "keeping the key confidential" even though confidentiality is not explicitly written — approval risk. artist.search/album.search/artist.getSimilar are good endpoints, but classify as last resort. 5 req/s is the commonly cited limit, not present in current terms.

4) LISTENBRAINZ labs similar-artists — verified live, strong optional upgrade path.
- `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<mbid>&algorithm=session_based_...` returned ~100 similar artists for Carpenter Brut with excellent neighbors: Perturbator (3571), Dance With the Dead, Waveshaper, Kavinsky (1419), GUNSHIP, Mitch Murder... The API changed: omitting `algorithm` (or using old defaults) returns HTTP 400 — the endpoint now requires an explicit algorithm string (e.g. `session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30`). Keyless, CORS not verified (JSON worked). Needs MBIDs, so it fits better as a related-artists upgrade (via MB search for MBID) than as a search source. Note the main api.listenbrainz.org docs push for a User-Agent and warn about 1-call-per-second → 429.

5) SPOTIFY Web API — definitively out for a no-backend static PWA.
- Live: unauthenticated `/v1/search` → 401. Docs today are stricter than the Nov 2024 removal of related-artists/recommendations for new dev-mode apps: apps in development mode require the OWNER to have Premium, are limited to 5 allowlisted authenticated users, and Extended-quota is org-only (registered business, ≥250k MAUs, form via company email, up to 6-week review, since May 15 2025). PKCE means every user logs in. Not viable.

6) TheAudioDB / Discogs — briefly.
- TheAudioDB: live 404 (even `-D coldplay`, i.e. `?s=coldplay`) on the free demo key `2`, and the old api_guide page 404s; site is up and selling Premium ($10/mo). The public no-key tier appears dead/unstable — not a primary.
- Discogs: `api.discogs.com/database/search?q=kavinsky` returned real results WITHOUT a token in our test (362 items, 8 pages) — historically documented as requiring OAuth/PAT, so treat keyless access as undocumented/unstable even if it works; also release-centric, no artist fan counts; CORS unverified. Not a fit.

Recommendation: Flip the primary artist search to Deezer `/search/artist` (keep JSONP for bulletproof browser support; debounce ~300ms). De-dupe by picking max `nb_fan` (tiebreak `nb_album`); that also yields the canonical Deezer artist id for the existing related-artists flow and a popularity score for the UI. Keep iTunes as the album/preview source it already is (iTunes still maps 1:1 to preview URLs), with Deezer `/search/album` as a quality fallback when iTunes 403/429s (verified to return both editions of Perturbator's Uncanny Valley). Use MusicBrainz WS/2 only as a non-realtime enrichment/verification step (≤1 req/s, live-verified 503 enforcement) — its 1 req/s-per-IP rule makes it unsafe for search-as-you-type from browsers. Optionally later: upgrade related-artists to ListenBrainz labs similar-artists (verified excellent results; requires MBID mapping and the new required `algorithm` param). Avoid Last.fm (key-in-client + written-approval clause) and Spotify (401 keyless, per-user login, org-only extended quota). Last.fm JSONP and Discogs keyless behavior are documented/live-checked respectively, but neither changes the ranking.

## Sources

- [Deezer JSONP artist search (live)](https://api.deezer.com/search/artist?q=carpenter%20brut&output=jsonp&callback=cb&limit=3)
- [Deezer album search (live)](https://api.deezer.com/search/album?q=perturbator+uncanny+valley&limit=5)
- [MusicBrainz API doc (rate limiting & User-Agent)](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API Rate Limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [MusicBrainz artist search (live)](https://musicbrainz.org/ws/2/artist?query=carpenter+brut&fmt=json&limit=5)
- [MetaBrainz forum: MusicBrainz CORS confirmed, JSONP declined (MBS-4057)](https://community.metabrainz.org/t/does-musicbrainz-api-support-jsonp/26144)
- [Last.fm API Terms of Service](https://www.last.fm/api/tos)
- [Last.fm REST/JSONP doc (callback param)](https://www.last.fm/api/rest)
- [ListenBrainz labs similar-artists (live, algorithm param required)](https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=303abdee-ffca-4685-a582-6aaaefd81b01&algorithm=session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30)
- [ListenBrainz labs dataset hoster endpoint catalog](https://labs.api.listenbrainz.org/)
- [Spotify quota modes (dev mode 5 users / premium owner / extended quota org-only)](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify search 401 without token (live)](https://api.spotify.com/v1/search?q=kavinsky&type=artist&limit=3)
- [TheAudioDB free-key search 404 (live)](https://www.theaudiodb.com/api/v1/json/2/search.php?s=coldplay)
- [Discogs search (live, returned results without token)](https://api.discogs.com/database/search?q=kavinsky)
- [MetaBrainz forum: client-side AJAX usage thread (unanswered)](https://community.metabrainz.org/t/musicbrainz-terms-of-service-for-client-side-ajax-website/815229)
