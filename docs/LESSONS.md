# Lessons

Short lessons from building this product, written by Slopper when work needed fixing. Read them before you start: they save you from mistakes earlier agents made.

- (#6) The landmines rule forbids mockImplementation on library/browser APIs in tests; for JSONP, observe the DOM insert with MutationObserver and invoke the generated global callback instead of stubbing appendChild.
