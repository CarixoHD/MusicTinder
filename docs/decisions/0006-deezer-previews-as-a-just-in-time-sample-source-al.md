# 0006. Deezer previews as a just-in-time sample source alongside iTunes

Date: 2026-11-21 · Status: Accepted

## Context

The owner wants every card to play a sample, whatever song it is, and asked whether there are sources besides Spotify and iTunes. Today artist and album cards get their sample only from an iTunes song search (top 5 hits, ~17 req/min budget shared with deck refills), so many cards say 'No sample'. ADR-002 said cards only ever carry iTunes previews because Deezer preview URLs are signed and expire after about 15 minutes.

## Options considered

- **iTunes only (status quo + wider search from #63)**: Simple, but every lookup spends the tight iTunes budget, and artists Apple can't match still get no sample.
- **Add Deezer previews just in time**: Keyless and already used via JSONP. /artist/{id}/top (artist cards already carry deezerArtistId) and /search/track return 30s MP3 previews. The URLs expire after about 15 minutes, so fetch them only when the card becomes current, never cache or persist them, and look them up again if playback fails.
- **Spotify preview_url**: Removed for new apps in Nov 2024, and the Web API needs an OAuth app. Ruled out.
- **Apple Music API / YouTube / SoundCloud**: Apple Music needs a paid developer token, YouTube needs an API key and an iframe player (not a clip), and SoundCloud is closed to new API apps. Ruled out under PRD 'no API keys'.

## Decision

Use Deezer as a second sample source. Artist cards try Deezer's /artist/{id}/top first and pick any track that has a preview. Album and song cards try iTunes first and fall back to a Deezer track search. Deezer preview URLs are resolved just in time and kept in memory only. They are never written to the cache, the store or Liked.

## Rationale

It roughly doubles sample coverage with no keys and no backend, reuses the existing JSONP transport, and takes artist-card lookups off the iTunes budget, which leaves that budget for deck refills. The ~15-minute expiry doesn't matter for a sample that plays within seconds of the card appearing.

## Sources

- [Spotify: changes to Web API (Nov 2024, preview_url deprecated for new apps)](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [Deezer API: artist top tracks](https://developers.deezer.com/api/artist/top)
