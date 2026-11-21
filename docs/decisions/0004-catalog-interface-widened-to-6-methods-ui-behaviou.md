# 0004. Catalog interface widened to 6 methods; UI behaviour tested through Playwright

Date: 2026-11-21 · Status: Accepted

## Context

ARCHITECTURE lists a 4-method Catalog. Generating candidates from seeds needs Deezer id resolution by name and iTunes genre enrichment of Deezer artists, and taste needs a shared-artist signal. The pinned stack has no React Testing Library.

## Options considered

- **Keep 4 methods, resolve ids inside adapters**: Hides cross-source joins in adapters; generation logic becomes untestable with FakeCatalog.
- **6-method Catalog + Card.related**: Adds resolveDeezerArtist(name) and enrichArtist(name); Card carries related anchor creatorKeys so score() can use shared-artist similarity.
- **Add @testing-library/react for UI tests**: Unverified extra dependency outside the pinned set.

## Decision

Catalog has searchSeeds, resolveDeezerArtist, relatedArtists, enrichArtist, artistTopTracks, artistAlbums (defined in src/types.ts by issue #1, stubs per adapter file, composed in src/catalog/index.ts). Card gains `related?: string[]` and `appleUrl?`; TasteWeights gains `origins` for the 'because you like X' line. UI behaviour is verified with Playwright specs against e2e/fixtures.ts mockCatalog; unit tests (Vitest) cover pure modules.

## Rationale

Keeps every cross-source join in pure, FakeCatalog-testable generation code (src/deck/generate.ts) so adapters stay one-file swaps, implements the PRD's 'genre overlap + shared artists' similarity explicitly, and avoids adding unpinned dependencies; Playwright is already required for the PRD's e2e/axe checks.
