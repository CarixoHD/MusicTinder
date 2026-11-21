# Lessons

Short lessons from building this product, written by Slopper when work needed fixing. Read them before you start: they save you from mistakes earlier agents made.

- (#6) The landmines rule forbids mockImplementation on library/browser APIs in tests; for JSONP, observe the DOM insert with MutationObserver and invoke the generated global callback instead of stubbing appendChild.
- (#7) Tests here must not replace fetch: use MSW (installed as msw 3.0.7). MSW 3 renames the option to `server.listen({ onUnhandledFrame: 'error' })`, and `HttpResponse.json` wants a `Record<string, any>`-compatible body, not `unknown`.
- (#2) The test-honesty landmine treats vi.spyOn(...).mockResolvedValue on fetch as a test double; catalog network tests must use msw (MSW v3 option is onUnhandledFrame, not onUnhandledRequest).
- (milestone review) Every iTunes request in src/catalog/ (search included) goes through withItunesBudget and cached(), and maps 403/429 to CatalogError('rate'); a direct fetch bypasses the shared ~17/min budget.
- (milestone review) The persisted-state read seam must check the shape of each slice (array/object, required fields) and fall back to defaults per slice; checking that JSON.parse succeeds is not enough.
- (milestone review) Search UIs should drop or visibly mark the previous term's results as soon as the term changes, not only when the next response arrives.
- (#10) In this shared sandbox, any e2e config must not assume 5173 is free: other worktrees' Playwright/dev servers use it. Derive the port from the worktree path (or honour PORT) rather than using a fixed default.
- (#12) When a test needs a browser API jsdom lacks (matchMedia), don't stub it: add an explicit parameter backed by a real default and pin the live browser behaviour in Playwright with page.emulateMedia.
- (milestone review) A deck status other than `dealing` needs its own copy: `stalled` (catalog failure) must render PRD's 'Couldn't reach the catalog' + retry, never the deck-end 'that's everything' screen, and an e2e test that aborts the catalog routes should pin it.
- (milestone review) Once a swipe gesture starts committing (fly-out), the button and arrow-key paths must ignore input until the deck has promoted the next card; otherwise two inputs race for the same card.
- (milestone review) Anything serialised behind the iTunes budget queue needs a fetch timeout, or one hung request blocks every later refill.
- (#23) FakeCatalog only enriched its three anchor artists, so any album/song deck generated from it was empty (DeeperCatalog existed to work around that) and a Discovery album test rendered no card. Extending FakeCatalog.enrichArtist/artistAlbums to cover related artists made album fixtures usable directly.
- (milestone review) A user setting that controls a running side effect (sound, theme) must act on it the moment it changes, not only on the next user action; pin that in e2e (toggle Sound off while a sample plays → no audio element is unpaused).
- (milestone review) Tester and demo seeders must write state the way the real flow does (a like also marks its key seen), otherwise the deck re-deals the demo data and creates duplicates.
- (milestone review) When matching catalog hits to a name, prefer an exact normalised match before any substring fallback, and tell a transient budget cool-down apart from a real 'no result' so the caller can retry.
