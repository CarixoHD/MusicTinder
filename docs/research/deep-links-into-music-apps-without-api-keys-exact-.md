# Deep links into music apps without API keys: exact https search/entity URL formats for Spotify, Apple Music and YouTube Music that open the installed app on iOS and Android (universal links/app links), and whether we can link to the exact entity (e.g. iTunes collectionViewUrl for Apple Music) vs search URLs.

Date: 2026-11-21 · Confidence: high

## Recommendation

Build all three link builders on keyless https entity URLs (they are verified universal links/app links; no custom schemes needed except an optional spotify: fallback). Spotify: https://open.spotify.com/{track|album|artist|playlist|search}/{id-or-query}. Apple Music: resolve via keyless iTunes Search API (https://itunes.apple.com/search?term=...&entity=song) and use the returned trackViewUrl as https://music.apple.com/{storefront}/album/{slug}/{collectionId}?i={trackId}, stripping &uo=4; use https://music.apple.com/{storefront}/search?term=... only as a fallback. YouTube Music: https://music.youtube.com/watch?v={videoId} (&list= for playlist context) and /search?q=. Pin unit tests to the exact examples observed (e.g. 697194953?i=697195462). Add one manual device check for Apple Music iOS app-opening since its AASA is not publicly fetchable.

## Findings

All three services use keyless https links on their web domains that open the installed mobile app. I verified this against the actual link-registration files and live pages (Nov 21, 2026):

SPOTIFY (open.spotify.com)
- Entity URL: https://open.spotify.com/{track|album|artist|playlist}/{base62Id} (e.g. https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6). Verified in Spotify's official "Spotify URIs and IDs" doc (spotify:track:6rqhFgbbKwnb9MLmUQDhG6 ↔ http://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6; also /user/ and /category/).
- iOS (AASA at open.spotify.com/.well-known/apple-app-site-association, fetched): paths include /track/*, /album/*, /artist/*, /playlist/*, /search/*, /browse/*, /s/* short links, plus locale-prefixed variants (e.g. /intl-??/album/*) and "/" catch-all, excluding NOT /__noul__/*. appIDs: 8W66MEA7DD.com.spotify.client, 2FNC3A47ZF.com.spotify.client, 78U2H6KMAF.com.spotify.client.internal.
- Android (open.spotify.com/.well-known/assetlinks.json, fetched): com.spotify.music verified with handle_all_urls (also lite, canary, tv).
- Search URL: https://open.spotify.com/search/{URL-encoded query} — /search/* is universal-link registered.
- Custom URI spotify:track:<id> still works as an in-app fallback but https works everywhere (desktop app too).

APPLE MUSIC (music.apple.com)
- Entity URL: https://music.apple.com/{storefront}/album/{slug}/{collectionId}?i={trackId} (e.g. https://music.apple.com/us/album/get-lucky/617154241?i=617154366). Verified live: the web-player search page emits exactly this format for tracks; albums drop ?i=. The slug appears optional (Apple tolerates any/missing slug) but include it from the API.
- EXACT entity linking is achievable with NO key: the iTunes Search API (https://itunes.apple.com/search?term=...&entity=song|album|artist&limit=N, keyless) returns trackViewUrl and collectionViewUrl on the music.apple.com domain — verified live response: trackViewUrl == "https://music.apple.com/us/album/one-more-time/697194953?i=697195462&uo=4". So the search API doubles as a term→canonical-link resolver; strip the harmless &uo=4 suffix.
- iOS: music.apple.com universal links open the Apple Music app. Caveat: Apple didn't serve a fetchable AASA (404 at music.apple.com/apple-app-site-association and on app-site-association.cdn-apple.com), so I verified the URL formats live but the app-opening behavior is from universal-link convention/Apple's own link tooling rather than a fetched AASA — worth one manual device test in QA.
- Android: verified (music.apple.com/.well-known/assetlinks.json): com.apple.android.music authorized with handle_all_urls.
- Search URL: https://music.apple.com/us/search?term={query} — verified live as a functional web-player search page. Whether iOS hands the search path to the Music app with the term preserved is not documented; prefer resolving via iTunes API then linking the entity, with this as fallback.
- Optional affiliate/marketing params (at, ct, ls=1) exist per Apple Performance Partners; not needed for app-opening, can be layered later via the Apple toolbox.marketingtools.com Link Builder.

YOUTUBE MUSIC (music.youtube.com)
- Entity URL: https://music.youtube.com/watch?v={videoId} (context: &list={playlistId}&si=...); playlists: https://music.youtube.com/playlist?list={playlistId}; artists are channels: /channel/{id}. Verified live: music.youtube.com/watch?v=dQw4w9WgXcQ serves the YT Music web app for "Never Gonna Give You Up" (YT's EU consent wall intercepted the first hop; resolved after consent). Entity = videoId; there is no artist/album ID scheme like the others.
- iOS (music.youtube.com/.well-known/apple-app-site-association, fetched): wildcard "*" for com.google.ios.youtubemusic (team EQHXZ8M8AV), excluding premium pages and NOT /redirect* — so watch/playlist/search all open the YT Music app.
- Android (music.youtube.com/.well-known/assetlinks.json, fetched): com.google.android.apps.youtube.music verified with handle_all_urls (plus .pwa, one fingerprint: CA:7C:DF:89:...D3:11).
- Search URL: https://music.youtube.com/search?q={query} (standard YT Music path, covered by wildcard).

Summary of guarantees: entity-level linking is exact and keyless for all three (Spotify base62 id; Apple Music collectionId+trackId via iTunes Search API — this IS the collectionViewUrl-style link; YT Music videoId). Search-in-app is solid for Spotify (/search/* registered); for Apple Music and YT Music use https search URLs as fallback and prefer pre-resolving via their keyless search APIs (iTunes Search API returns canonical music.apple.com IDs; YT Music uses videoId which you'll get from the YouTube/YT Music data flow). Recommended builder: one normalize() per provider producing the https URL, plus optional spotify: URI intent fallback; unit-test URL construction against the canonical examples above (all are keyless and stable).

## Sources

- [Spotify Developers — Spotify URIs and IDs](https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids)
- [Spotify iOS Universal Links AASA (fetched, .well-known)](https://open.spotify.com/.well-known/apple-app-site-association)
- [Spotify Android App Links assetlinks.json (fetched)](https://open.spotify.com/.well-known/assetlinks.json)
- [iTunes Search API — live keyless search response showing trackViewUrl/collectionViewUrl on music.apple.com](https://itunes.apple.com/search?term=daft+punk+one+more+time&entity=song&limit=1)
- [Apple Music web-player search page (verified /us/search?term= format and track link URLs)](https://music.apple.com/us/search?term=daft%20punk)
- [Apple Music Android App Links assetlinks.json (fetched, com.apple.android.music)](https://music.apple.com/.well-known/assetlinks.json)
- [YouTube Music iOS AASA (fetched, wildcard paths for com.google.ios.youtubemusic)](https://music.youtube.com/.well-known/apple-app-site-association)
- [YouTube Music Android App Links assetlinks.json (fetched, com.google.android.apps.youtube.music)](https://music.youtube.com/.well-known/assetlinks.json)
- [YouTube Music web app track page (verified /watch?v= format)](https://music.youtube.com/watch?v=dQw4w9WgXcQ)
- [Apple Music Marketing Tools (Link Builder / Subscribe Links)](https://toolbox.marketingtools.apple.com/apple-music)
