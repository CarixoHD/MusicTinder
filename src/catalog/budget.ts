/**
 * iTunes token bucket: Apple allows ~20 requests/minute, so spend at most 17
 * and never make the deck wait. Lookups are serialised; with no token left a
 * call resolves its empty fallback at once, leaving cards un-enriched.
 */
export const ITUNES_BUDGET = 17;
export const BUDGET_WINDOW_MS = 60_000;

let tokens = ITUNES_BUDGET;
let refilledAt = Date.now();
let queue: Promise<unknown> = Promise.resolve();

/** Restore the bucket and forget queued work (test isolation, retry flows). */
export function resetItunesBudget(): void {
  tokens = ITUNES_BUDGET;
  refilledAt = Date.now();
  queue = Promise.resolve();
}

/**
 * Spend one token for `load`; with fewer than `1 + reserve` tokens left (or none
 * without a reserve) resolve `empty` at once. Background work passes a reserve so
 * a burst of enrichment cannot starve the requests a visible card depends on.
 */
export function withItunesBudget<T>(empty: T, load: () => Promise<T>, reserve = 0): Promise<T> {
  const now = Date.now();
  // Lazy refill: no timer to leak, and fake timers can move the clock freely.
  tokens = Math.min(ITUNES_BUDGET, tokens + ((now - refilledAt) * ITUNES_BUDGET) / BUDGET_WINDOW_MS);
  refilledAt = now;

  if (tokens < 1 + reserve) return Promise.resolve(empty);
  tokens -= 1;

  const result = queue.then(load);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
