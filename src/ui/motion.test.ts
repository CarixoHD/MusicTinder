import { afterEach, describe, expect, it, vi } from 'vitest';
import { onReducedMotionChange, prefersReducedMotion } from './motion';
import { withTransition } from './transition';

// jsdom's matchMedia never changes; tests need a query they can flip.
class FakeMediaQueryList extends EventTarget {
  matches: boolean;
  readonly media = '(prefers-reduced-motion: reduce)';

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  set(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(Object.assign(new Event('change'), { matches }));
  }
}

function stubReducedMotion(matches: boolean): FakeMediaQueryList {
  const list = new FakeMediaQueryList(matches);
  vi.stubGlobal('matchMedia', () => list);
  return list;
}

const fakeViewTransition = (update: () => void) => {
  update();
  return {
    finished: Promise.resolve(),
    ready: Promise.resolve(),
    types: new Set<string>(),
    updateCallbackDone: Promise.resolve(),
    skipTransition: () => undefined,
  };
};

function stubStartViewTransition(): ReturnType<typeof vi.fn> {
  const start = vi.fn(fakeViewTransition);
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  return start;
}

afterEach(() => {
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  vi.unstubAllGlobals();
});

describe('reduced-motion preference', () => {
  it('reflects the current media query', () => {
    stubReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);

    stubReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('notifies on every flip and stops after unsubscribe', () => {
    const query = stubReducedMotion(false);
    const onChange = vi.fn();

    const unsubscribe = onReducedMotionChange(onChange);
    query.set(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    query.set(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    query.set(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('withTransition', () => {
  it('runs the update synchronously with no view transition under reduced motion', () => {
    stubReducedMotion(true);
    const start = stubStartViewTransition();
    let ran = false;

    withTransition(() => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('uses startViewTransition when the browser supports it', () => {
    stubReducedMotion(false);
    const start = stubStartViewTransition();
    const update = vi.fn();

    withTransition(update);

    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update synchronously when startViewTransition is unavailable', () => {
    stubReducedMotion(false);
    let ran = false;

    withTransition(() => {
      ran = true;
    });

    expect(ran).toBe(true);
  });
});
