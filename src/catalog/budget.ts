/**
 * iTunes token bucket: Apple allows ~20 requests/minute, so spend at most 17
 * and never make the deck wait. Lookups are serialised; with no token left a
 * call resolves its empty fallback at once, leaving cards un-enriched.
 *
 * The visible card's preview may instead wait for the next refill: it is what
 * the listener is listening to, and a cool-down must not leave it silent for
 * good. Waiting lookups are served highest priority first at each refill.
 */
export const ITUNES_BUDGET = 17;
export const BUDGET_WINDOW_MS = 60_000;

export interface BudgetOptions {
  /** Tokens background work must leave free for the visible card's own lookups. */
  reserve?: number;
  /** Wait for the next refill instead of resolving `empty` during a cool-down. */
  wait?: boolean;
  /** The visible card's lookup goes before lower-priority lookups that wait. */
  priority?: boolean;
  /** Abandon the wait (the card left the deck); resolves `empty`, spends nothing. */
  signal?: AbortSignal;
}

let tokens = ITUNES_BUDGET;
let refilledAt = Date.now();
let queue: Promise<unknown> = Promise.resolve();

interface Waiter {
  priority: boolean;
  grant: () => void;
  cancel: () => void;
}

let waiters: Waiter[] = [];
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function refill(): void {
  const now = Date.now();
  // Lazy refill: no timer to leak, and fake timers can move the clock freely.
  tokens = Math.min(ITUNES_BUDGET, tokens + ((now - refilledAt) * ITUNES_BUDGET) / BUDGET_WINDOW_MS);
  refilledAt = now;
}

/** Hand the free tokens to waiting lookups, the visible card's first. */
function grantWaiters(): void {
  refill();
  while (tokens >= 1 && waiters.length > 0) {
    waiters.sort((a, b) => Number(b.priority) - Number(a.priority));
    const waiter = waiters.shift();
    if (waiter === undefined) break;
    tokens -= 1;
    waiter.grant();
  }
  scheduleWake();
}

function scheduleWake(): void {
  if (wakeTimer !== null || waiters.length === 0) return;
  refill();
  if (tokens >= 1) {
    grantWaiters();
    return;
  }
  const waitMs = Math.ceil(((1 - tokens) * BUDGET_WINDOW_MS) / ITUNES_BUDGET);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    grantWaiters();
  }, Math.max(1, waitMs));
}

function waitForToken(options: BudgetOptions): Promise<boolean> {
  const { priority = false, signal } = options;
  if (signal?.aborted) return Promise.resolve(false);
  refill();
  if (tokens >= 1) {
    tokens -= 1;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const waiter: Waiter = {
      priority,
      grant: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      },
      cancel: () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(false);
      },
    };
    const onAbort = () => {
      waiters = waiters.filter((candidate) => candidate !== waiter);
      waiter.cancel();
    };
    signal?.addEventListener('abort', onAbort);
    waiters.push(waiter);
    scheduleWake();
  });
}

function enqueue<T>(load: () => Promise<T>): Promise<T> {
  const result = queue.then(load);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Restore the bucket and forget queued work (test isolation, retry flows). */
export function resetItunesBudget(): void {
  tokens = ITUNES_BUDGET;
  refilledAt = Date.now();
  queue = Promise.resolve();
  if (wakeTimer !== null) clearTimeout(wakeTimer);
  wakeTimer = null;
  const abandoned = waiters;
  waiters = [];
  for (const waiter of abandoned) waiter.cancel();
}

/**
 * Spend one token for `load`; with fewer than `1 + reserve` tokens left (or none
 * without a reserve) resolve `empty` at once. Background work passes a reserve so
 * a burst of enrichment cannot starve the requests a visible card depends on.
 * A `wait` lookup joins the refill queue and runs as soon as a token is free.
 */
export function withItunesBudget<T>(empty: T, load: () => Promise<T>, options: BudgetOptions = {}): Promise<T> {
  refill();
  if (tokens < 1 + (options.reserve ?? 0)) {
    if (!options.wait) return Promise.resolve(empty);
    return waitForToken(options).then((granted) => (granted ? enqueue(load) : empty));
  }
  tokens -= 1;
  return enqueue(load);
}
