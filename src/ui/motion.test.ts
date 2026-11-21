import { describe, expect, it } from 'vitest';
import { onReducedMotionChange, prefersReducedMotion, type ReducedMotionQuery } from './motion';
import { withTransition } from './transition';

/** A real, controllable media-query stand-in: listeners are registered and
 * fired like the browser does, only the OS preference is under our control. */
class TestQuery implements ReducedMotionQuery {
  matches: boolean;
  private readonly listeners = new Set<(event: { matches: boolean }) => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.delete(listener);
  }

  flip(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

describe('reduced-motion preference', () => {
  it('reflects the current media query', () => {
    expect(prefersReducedMotion(new TestQuery(false))).toBe(false);
    expect(prefersReducedMotion(new TestQuery(true))).toBe(true);
  });

  it('notifies on every flip and stops after unsubscribe', () => {
    const query = new TestQuery(false);
    const changes: boolean[] = [];

    const unsubscribe = onReducedMotionChange((reduced) => changes.push(reduced), query);
    query.flip(true);
    query.flip(false);
    expect(changes).toEqual([true, false]);

    unsubscribe();
    query.flip(true);
    expect(changes).toEqual([true, false]);
  });
});

describe('withTransition', () => {
  it('runs the update synchronously with no view transition under reduced motion', () => {
    let starts = 0;
    let ran = false;

    withTransition(
      () => {
        ran = true;
      },
      {
        reducedMotion: true,
        startViewTransition: () => {
          starts += 1;
        },
      },
    );

    expect(ran).toBe(true);
    expect(starts).toBe(0);
  });

  it('uses startViewTransition when the browser supports it', () => {
    let starts = 0;
    let ran = false;

    withTransition(
      () => {
        ran = true;
      },
      {
        reducedMotion: false,
        startViewTransition: (update) => {
          starts += 1;
          update();
        },
      },
    );

    expect(starts).toBe(1);
    expect(ran).toBe(true);
  });

  it('runs the update synchronously when startViewTransition is unavailable', () => {
    let ran = false;

    withTransition(
      () => {
        ran = true;
      },
      { reducedMotion: false },
    );

    expect(ran).toBe(true);
  });
});
