import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET_WINDOW_MS } from '../../catalog/budget';
import { DeckNotice } from './DeckNotice';

let container: HTMLDivElement;
let root: Root;

const renderNotice = (onRetry: () => void) =>
  act(() =>
    root.render(
      <DeckNotice
        status="cooling"
        emptyReason={null}
        hasCards={false}
        onRetry={onRetry}
        onChangeSeeds={() => undefined}
      />,
    ),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('DeckNotice cool-down', () => {
  it('shows calm wait copy and Retry, not the seed-blaming or outage copy', () => {
    const onRetry = vi.fn();
    renderNotice(onRetry);

    expect(container.textContent).toContain('Still looking');
    expect(container.textContent).toContain('Trying again in a moment');
    expect(container.textContent).not.toContain('Nothing to recommend');
    expect(container.textContent).not.toContain('Couldn’t reach the catalog');
    expect(container.textContent).not.toContain('Check your connection');

    const retry = container.querySelector<HTMLButtonElement>('.empty-state__actions button');
    expect(retry?.textContent).toBe('Retry');
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retries by itself once the iTunes window refills', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    renderNotice(onRetry);

    act(() => vi.advanceTimersByTime(BUDGET_WINDOW_MS - 1));
    expect(onRetry).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
