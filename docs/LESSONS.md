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
- (milestone review) A mute setting changes what explicit Play does as well: decide whether a user-initiated play while Sound is off turns Sound back on or shows a visible 'sound off' state, and pin that choice in e2e instead of letting the sample play silently while the card shows it as playing.
- (milestone review) State kept outside React (module-level sessions, caches) must be cleared by resetAll() and must never feed values back into the store after a reset.
- (milestone review) A component that adopts a long-lived object across mounts must subscribe to its changes (or re-join its pending promise); a .then() bound to the mount that started the work leaves later mounts stale.
- (milestone review) Test session/retention features with work still in flight at the moment of leaving and returning, not only when everything has already settled.
- (milestone review) When a wipe has to invalidate state held outside React, a runtime epoch in the store that the session key includes is a simple, testable way to do it; also guard any effect that writes data back into the store against output from an older epoch.
- (milestone review) A budget cool-down (withItunesBudget resolving its empty fallback) must reach the deck as a retryable state, never as 'nothing there'. Otherwise empty-state copy blames the seeds or claims the deck has ended.
- (milestone review) Anything that adds work to the serialised iTunes queue (seed search included) needs a fetch timeout, so one hung request cannot freeze every later request.
- (milestone review) E2e tests should assert the settled screen, not a transient loading heading that a fast failure state can replace.
- (milestone review) When a lower layer changes a 'no result' return into a typed error, use the error kind in the user-facing copy too: a rate cool-down should say to wait a moment, not to check the connection.
- (milestone review) When you change a layout cap that an earlier issue added for another reason (e.g. keeping controls clear of the tab bar), re-check that reason at short viewports (1280x600/720, 360x640) and pin it in e2e.
- (milestone review) Layout fixes that promise 'the same size on every card' should be tested by swiping several cards with different text lengths and comparing sizes, not by measuring the first card alone.
- (milestone review) A journey that pins a ranking 'lean' must place the disliked items where raw catalogue order would deal them inside the asserted window, so the assertion fails when taste has no effect.
- (milestone review) When a change adds iTunes lookups to the refill path, check what the shared budget leaves for just-in-time samples and whether a sample request that hits the cool-down is ever retried.
- (milestone review) A failure 'kind' that can be retried (budget cool-down, server 429, offline) must reach the UI as a different state from a real 'no result', both in the return type and in what the card shows while waiting.
- (milestone review) When a status value such as 'nosample' means several different things in the player, don't trigger new behaviour on it alone; check why it was emitted or keep separate state for 'waiting on lookup'.
