# Lessons

Short lessons from building this product, written by Slopper when work needed fixing. Read them before you start: they save you from mistakes earlier agents made.

- (#6) The landmines rule forbids mockImplementation on library/browser APIs in tests; for JSONP, observe the DOM insert with MutationObserver and invoke the generated global callback instead of stubbing appendChild.
- (#7) Tests here must not replace fetch: use MSW (installed as msw 3.0.7). MSW 3 renames the option to `server.listen({ onUnhandledFrame: 'error' })`, and `HttpResponse.json` wants a `Record<string, any>`-compatible body, not `unknown`.
- (#2) The test-honesty landmine treats vi.spyOn(...).mockResolvedValue on fetch as a test double; catalog network tests must use msw (MSW v3 option is onUnhandledFrame, not onUnhandledRequest).
- (milestone review) Every iTunes request in src/catalog/ (search included) goes through withItunesBudget and cached(), and maps 403/429 to CatalogError('rate'); a direct fetch bypasses the shared ~17/min budget.
- (milestone review) The persisted-state read seam must check the shape of each slice (array/object, required fields) and fall back to defaults per slice; checking that JSON.parse succeeds is not enough.
- (milestone review) Search UIs should drop or visibly mark the previous term's results as soon as the term changes, not only when the next response arrives.
