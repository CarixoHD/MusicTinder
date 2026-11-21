# Lessons

Short lessons from building this product, written by Slopper when work needed fixing. Read them before you start: they save you from mistakes earlier agents made.

- (#6) The landmines rule forbids mockImplementation on library/browser APIs in tests; for JSONP, observe the DOM insert with MutationObserver and invoke the generated global callback instead of stubbing appendChild.
- (#7) Tests here must not replace fetch: use MSW (installed as msw 3.0.7). MSW 3 renames the option to `server.listen({ onUnhandledFrame: 'error' })`, and `HttpResponse.json` wants a `Record<string, any>`-compatible body, not `unknown`.
- (#2) The test-honesty landmine treats vi.spyOn(...).mockResolvedValue on fetch as a test double; catalog network tests must use msw (MSW v3 option is onUnhandledFrame, not onUnhandledRequest).
