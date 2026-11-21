# 0005. Artist seed search goes Deezer-first; iTunes stays the source for albums and previews

Date: 2026-11-21 · Status: Accepted

## Context

The owner reported iTunes rate-limit errors in Setup's artist search and asked whether better search APIs exist. iTunes Search allows about 20 requests/min per IP, and the deck's enrichment draws on the same budget. #46 (in progress) makes search wait for the budget and fall back to Deezer. This decision makes Deezer the primary source for artist search.

## Options considered

- **Keep iTunes primary + Deezer fallback (#46 as is)**: Fixes the visible error, but every keystroke pause still spends a token from the ~20/min budget the deck needs, and waits feel slow.
- **Deezer /search/artist primary (JSONP)**: Keyless and about 50 req/5s (~30x iTunes). Gives fan counts, pictures and the Deezer id that generation anchors on. Duplicate profiles exist, so rank/de-dupe by nb_fan. No genres, so chips come from enrichArtist after a pick.
- **MusicBrainz WS/2**: Best data quality and CORS works, but a hard limit of 1 req/s per IP (503 seen live) and browsers can't set a User-Agent. Unsafe for search-as-you-type.
- **Last.fm**: Good search and getSimilar, but needs an API key shipped in the client, the ToS requires written approval for public access, and it is non-commercial only.
- **Spotify Web API**: 401 without a token, PKCE requires every user to log in, dev mode is capped at 5 users, and related-artists is gone for new apps. Not viable.
- **TheAudioDB / Discogs**: TheAudioDB's free key returns 404. Discogs keyless access is undocumented and release-centric. Neither fits.

## Decision

Setup's artist search queries Deezer /search/artist first, ranks profiles by fan count (duplicates with few fans go below the main profile) and shows the fan count. The picked seed carries deezerArtistId, and its genre chips are filled after the pick via catalog.enrichArtist (budget-waiting, off the typing path). iTunes artist search is used only if Deezer fails. Album search stays on iTunes, with Deezer /search/album as a later fallback. ListenBrainz labs similar-artists (needs MBIDs) is noted as a possible later upgrade for related artists.

## Rationale

Deezer's ~30x larger rate budget removes the rate-limit error at its source. Typing in Setup then no longer drains the iTunes budget the deck needs for previews and artwork. Deezer also returns the id generation already anchors on, which removes the name→id resolution step that #42 and #45 had to fix. The other options fail on rate limits, keys/ToS or user login.

## Sources

- [MusicBrainz API rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Last.fm API Terms of Service](https://www.last.fm/api/tos)
- [Spotify Web API quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Deezer artist search (live JSONP)](https://api.deezer.com/search/artist?q=carpenter%20brut&output=jsonp&callback=cb&limit=3)
- [ListenBrainz labs similar-artists](https://labs.api.listenbrainz.org/)
