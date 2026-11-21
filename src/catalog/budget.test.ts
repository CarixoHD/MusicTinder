import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ITUNES_BUDGET, resetItunesBudget, withItunesBudget } from './budget';

const ONE_TOKEN_MS = Math.ceil(60_000 / ITUNES_BUDGET) + 100;

let started: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  resetItunesBudget();
  started = [];
});

afterEach(() => {
  vi.useRealTimers();
});

/** Spend the bucket down to nothing, so the next lookup must wait. */
async function coolDown(): Promise<void> {
  for (let token = 0; token < ITUNES_BUDGET; token += 1) {
    await withItunesBudget(null, async () => null);
  }
}

const record = (name: string) => async (): Promise<null> => {
  started.push(name);
  return null;
};

describe('iTunes budget cool-down', () => {
  it('still answers a background lookup at once, without waiting', async () => {
    await coolDown();

    await expect(
      withItunesBudget(null, record('background'), { reserve: 2 }),
    ).resolves.toBeNull();
    expect(started).toEqual([]);
  });

  it('serves the visible card’s lookup before a prefetch lookup waiting for the same refill', async () => {
    await coolDown();

    const prefetch = withItunesBudget(null, record('prefetch'), { wait: true });
    const visible = withItunesBudget(null, record('visible'), { wait: true, priority: true });

    // One token's worth of refill: only one of the two can be served.
    await vi.advanceTimersByTimeAsync(ONE_TOKEN_MS);
    expect(started).toEqual(['visible']);

    await vi.advanceTimersByTimeAsync(ONE_TOKEN_MS);
    expect(started).toEqual(['visible', 'prefetch']);
    await Promise.all([visible, prefetch]);
  });

  it('abandons a waiting lookup when its card leaves without spending a token', async () => {
    await coolDown();
    const controller = new AbortController();

    const waiting = withItunesBudget(null, record('gone'), {
      wait: true,
      priority: true,
      signal: controller.signal,
    });
    controller.abort();

    await expect(waiting).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toEqual([]);
  });
});
