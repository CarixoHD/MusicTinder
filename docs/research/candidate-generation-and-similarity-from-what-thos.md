# Candidate generation and similarity from what those APIs expose: how to build a pool of similar artists/albums/songs from seeds (Deezer related artists, iTunes genre IDs, shared-artist co-occurrence), how to map source genre strings to a curated 25–40 chip taxonomy, how many requests per deck refill that costs within rate limits, and how to pick artist-card imagery (Deezer artist pictures vs iTunes album art). What is prior art for lightweight client-side content-based re-ranking with like/skip weight vectors?

Date: 2026-11-21 · Confidence: high

## Recommendation

Use Deezer's public API as the recommendation spine (one `/artist/{id}/related` call per seed returns 10-20 ranked similar artists with 250px/500px images already embedded; `/artist/{id}/radio` converts artists to song cards in one more call), with iTunes Search/Lookup only as enrichment per new artist (one album lookup each for `artworkUrl100`, `primaryGenreId/Name`, stable 30s previews) — and budget one iTunes refill per minute max since Apple enforces ~20 req/min while Deezer tolerates ~50 req/5s. Build the 25-40 chip taxonomy offline by normalizing iTunes `primaryGenreName` strings (learn genre IDs from primaryGenreId at runtime; Deezer's ~21 genres are too coarse to define chips). Implement client-side re-ranking as Rocchio relevance feedback on a genre-chip/vector preference state (α≈0.85 history, β≈0.6 like, γ≤0.2 skip, discount sub-5s skips), derive "because you like X" from the best-matching liked seed, and prefetch the next deck during the current one. Primary imagery: Deezer artist pictures (zero extra requests); iTunes album art only for track cards and image fallbacks.

## Findings

All conclusions below were live-verified today against api.deezer.com and itunes.apple.com unless marked otherwise.

=== 1. CANDIDATE GENERATION (data shapes, live-verified) ===

DEEZER is the similarity spine. Unauthenticated public endpoints, JSON, pagination `{data, total, next}`:
- `/artist/{id}/related?limit=N` → array of artist objects: `id, name, picture_small(56px)/picture_medium(250px)/picture_big(500px)/picture_xl(1000px), nb_album, nb_fan, radio, tracklist, type:"artist"`. Verified for Daft Punk (id 27, total 20 related: Justice, Calvin Harris, Chemical Brothers…). This is the single highest-value endpoint: ONE request returns ~10-20 ranked similar artists WITH usable card imagery already attached (no extra image calls).
- `/artist/{id}/radio?limit=N` → track objects (`title, duration, rank, preview (signed, expiring CDN URL), artist{id,name}, album{id,title,cover_medium}`) — one request seeds actual song cards, not just artists.
- `/genre/{id}/artists`, `/chart/0/artists` (global charts) exist as coarse-pool backups. Caution: `/genre/132/artists` in my test returned a broad, apparently geo/noisy list (45 artists mixing Taylor Swift and Bach) — verify country/locale handling before relying on genre pools; related-artists and radio were clean.
- Deezer has only ~21 top-level genres (132 Pop, 116 Rap/Hip Hop, 152 Rock, 113 Dance, 165 R&B, 85 Alternative, 106 Electro, 129 Jazz, 98 Classical, 464 Metal, 169 Soul & Funk, etc.) — far too coarse for a 25–40 chip taxonomy. Don't build chips off Deezer genre ids.
- `search?q=&order=` requires a non-empty query; no multi-label search (per official Deezer dev FAQ; docs sit behind a login wall, so most schema detail comes from live probing + mirrors).

iTUNES (Search API, performance-partners.apple.com/search-api, official):
- No "similar artist" concept at all. Candidate discovery via `/search?term=&media=music&entity=musicArtist|album|song&attribute=artistTerm|albumTerm|genreIndex&limit=1..200` (default 50). Search results carry NO genreId field — only the string `primaryGenreName`.
- `/lookup?id=<iTunesArtistId>&entity=album&limit=N` returns the artist object followed by album (collection) objects with `collectionId, collectionName, primaryGenreName, primaryGenreId, artworkUrl100, releaseDate, trackCount`. VERIFIED: lookup responses DO include `primaryGenreId` (Jack Johnson → genre "Rock", primaryGenreId 21) — so genre IDs can be learned at runtime from lookups rather than hardcoded; Apple publishes no official genre-ID list.
- Caveat found live: comma-separated `id=a,b&entity=song` lookup resolved only ONE of two artists — assume 1 lookup per artist, don't count on batching.
- `previewUrl` (30s AAC, stable audio-ssl.itunes.apple.com URL) is present on every track — free 30-second previews for cards. Deezer preview URLs are signed and expire, so prefer iTunes previews on cards or re-fetch Deezer tracklists fresh.
- Shared-artist co-occurrence is NOT cheaply available from either API (no "artists also liked" on iTunes; Deezer's related-artists already encodes the editorial/collaborative co-occurrence signal server-side). Emulating co-occurrence client-side via `entity=song` term searches ("songs by artists like X") is fuzzy and burns requests — recommended only as fallback.

=== 2. GENRE → 25–40 CHIP TAXONOMY ===
Build the chip taxonomy from iTunes `primaryGenreName` strings (hundreds of fine genres: "Rock", "Hip-Hop/Rap", "Alternative & Punk", "R&B/Soul", "Country"…), not from Deezer's 21 coarse genres. Two-step: (a) curated normalization table mapping source strings to chips, e.g. "Hip-Hop/Rap"→hip-hop, "Rap"→hip-hop, "Alternative"→indie, "R&B/Soul"→r&b-soul, "House"→electronic, plus a catch-all normalization (lowercase, split on "/","&","-"); (b) at runtime, log any unseen primaryGenreName and fold it into the nearest chip (or bucket "other"), keeping the table as seed data. Chips are one-hot dimensions of the candidate vector; Deezer genre ids are useful only to bias the initial pool (e.g. genre 116 Rap anchor chart) with one cheap request.

=== 3. REQUEST BUDGET PER DECK REFILL ===
- iTunes: "approximately 20 calls per minute (subject to change)" — OFFICIAL, this is the binding constraint. No Retry-After to rely on.
- Deezer: not officially published (docs login-walled; official FAQ says only "there is a query quota"). Community/third-party consensus: ~50 requests per 5 seconds, 429 + Retry-After. Treat as per-app, cache aggressively.
- Concrete budget for a 20-card deck refill (Deezer spine + iTunes imagery): Deezer: 3 seed related-artist calls (3 req) + optional 2-3 artist/radio calls for track variety ≈ 5-6 req — trivial inside 50/5s. iTunes: 1 search (entity=musicArtist) to resolve an unknown seed + 1 album-lookup per new artist (~10-15 artists/deck) = ~11-16 req — feasible but only ONE refill per minute unless cached/prefetched. Implication: prefetch the next deck during the current one (refill every ~10 swipes → ~2 min window), cache lookups ≥24h (imagery/genre are immutable per album), and let Deezer related-artists payloads (which already include 250px artist pictures) carry artists so only ~half the artists need iTunes album-art enrichment.

=== 4. ARTIST-CARD IMAGERY ===
Prefer Deezer artist pictures as primary card art: the related-artists response already embeds `picture_medium` (250px)/`picture_big` (500px) CDN URLs (cdn-images.dzcdn.net/images/artist/<hash>/250x250-000000-80-0-0.jpg) — zero extra requests and consistent square portraits per artist. Use iTunes album art (`artworkUrl100`, is1-ssl.mzstatic.com …/100x100bb.jpg) when a card is track/album-oriented or an artist lacks a Deezer photo; the `100x100bb.jpg` suffix can be rewritten to larger sizes (e.g. `600x600bb.jpg`) but that is a community convention not documented by Apple — handle load failures and fall back to 100x100. Deezer artist images are artist-representative portrait-style photos (better for an artist-swipe UX); iTunes art is album cover of the looked-up album (arbitrary which album you chose). Suggested: Deezer picture_medium/picture_big default, iTunes artwork as track-card art and as fallback.

=== 5. PRIOR ART: CLIENT-SIDE CONTENT-BASED RE-RANKING WITH LIKE/SKIP VECTORS ===
- The canonical prior art is the Rocchio relevance-feedback algorithm (Rocchio 1971): maintain a normalized preference vector q; on feedback q' = α·q + β·mean(liked-item vectors) − γ·mean(disliked-item vectors). Fully client-side, O(1) per swipe, trivially serializable to localStorage — a direct fit for a like/skip weight vector over genre chips + numerical features (popularity, era, energy-proxy-from-duration? etc.). Practical α≈0.85–0.9 keeps user history stable; β≈0.6, γ≈0.2 with γ<β (negative feedback is noisier).
- Key semantic caveat from the implicit-feedback literature (Jannach et al., "Recommending based on Implicit Feedback", 2018): in music, a SKIP is context-dependent and not necessarily a negative judgment of the artist — apply negative weight only to the artist/card skipped, and discount skips that happen <5s into a card (fat-finger/queue-browse behavior).
- Explore/exploit: the standard lightweight upgrade is a ε-greedy or LinUCF-style contextual bandit (Li et al. 2010, Yahoo News is the classic deployment) — a simpler proxy is to always include 2–3 cards from the least-represented high-affinity chip, which also preserves the "because you like X" narrative.
- Product prior art: Swipefy (App Store, "Tinder for music" over Spotify's catalog) — swipe-based track discovery where swipes generate playlists; Spotify's Discover Weekly / "Because you listened to X" rows demonstrate the accepted explanation pattern (cite the single highest-similarity liked seed for each card). Academic confirmation that swipe-style implicit feedback is now a studied interaction modality: ACM "Endless Swipes and Recommendations" (2026).
- Explanation ("because you like X") falls out of the vector design for free: score(candidate, prefs) = cos(v_candidate, v_prefs); explanation = the liked seed with the highest cosine to the candidate — no extra model needed.

=== IMPLICATIONS FOR THE SCORING MODULE INTERFACE ===
Candidates can arrive as either (a) Deezer artist objects (with embedded pictures + nb_fan) or (b) iTunes collection objects (artworkUrl100 + primaryGenreName/Id) — the scoring interface should accept a unified CardCandidate{source, id, name, image, genreStrings[], popularity?, seedIds[]} and normalize genres to chips inside the module. The prefetcher needs only {deezerRelatedDepth, itunesLookupsPerArtist} parameters; deck refill fits iTunes' 20/min with a 10-swipe prefetch horizon and 24h metadata cache.

## Sources

- [iTunes Search API — Apple Services Performance Partners (official; 20 calls/min, params, artworkUrl60/100)](https://performance-partners.apple.com/search-api)
- [iTunes Search API: Constructing Searches — Apple Developer (attributes, entities, limits)](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
- [Deezer FAQs For Developers (official: query quota statement, search/order, CORS/JSONP)](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
- [Deezer developer docs portal (login-walled API reference)](https://developers.deezer.com/api)
- [Deezer Public API mirror — Artist module documentation (object fields: picture sizes, nb_fan, nb_album)](https://zaosoula.github.io/deezer-public-api/api-reference/artist)
- [Music API rate-limiting guide (Deezer ~50 req/5s, Spotify ~180/min, Apple Music burst caps, caching TTL advice)](https://musicapi.com/blog/music-api-rate-limiting-guide)
- [Live probe: api.deezer.com/artist/27/related?limit=10 (related artists + picture CDN fields)](https://api.deezer.com/artist/27/related?limit=10)
- [Live probe: api.deezer.com/artist/27/radio?limit=5 (track/album/preview shape)](https://api.deezer.com/artist/27/radio?limit=5)
- [Live probe: api.deezer.com/genre (the 21 top-level genre ids)](https://api.deezer.com/genre)
- [Live probe: itunes.apple.com/lookup?id=909253&entity=album (primaryGenreId, artworkUrl100)](https://itunes.apple.com/lookup?id=909253&entity=album&limit=5)
- [Live probe: itunes.apple.com/lookup multi-id batch (only one artist resolved — confirms per-artist lookups)](https://itunes.apple.com/lookup?id=909253,1442247989&entity=song&limit=10)
- [Swipefy: Find Music on Spotify — App Store (product prior art: Tinder-for-music swipe UX)](https://apps.apple.com/us/app/swipefy-find-music-on-spotify/id6449814769)
- [Jannach et al. — Recommending based on Implicit Feedback (skip ≠ dislike caveat in music)](https://web-ainf.aau.at/pub/jannach/files/BookChapter_Social_Information_Access_2018.pdf)
- [ACM — Endless Swipes and Recommendations (2026; swipe-based recommendation interaction as studied modality)](https://dl.acm.org/doi/pdf/10.1145/3772318.3791959)
- [Penha & Hauff TU Delft thesis citing Rocchio 1971 Relevance Feedback (canonical like/dislike vector update prior art)](https://research.tudelft.nl/files/151703921/thesis_GustavoPenha.pdf)
