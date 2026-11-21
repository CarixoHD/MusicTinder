// Live reduced-motion preference. Read the media query on every call (never a
// load-time capture) and subscribe to its changes so motion can follow the OS
// setting without a reload. The query is a parameter so tests can hand in a
// controllable preference instead of replacing window.matchMedia.
const QUERY = '(prefers-reduced-motion: reduce)';

export interface ReducedMotionQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

const browserQuery = (): ReducedMotionQuery | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(QUERY);

export function prefersReducedMotion(query: ReducedMotionQuery | null = browserQuery()): boolean {
  return query?.matches ?? false;
}

export function onReducedMotionChange(
  callback: (reduced: boolean) => void,
  query: ReducedMotionQuery | null = browserQuery(),
): () => void {
  if (!query) return () => undefined;

  const handleChange = (event: { matches: boolean }) => callback(event.matches);
  query.addEventListener('change', handleChange);
  return () => query.removeEventListener('change', handleChange);
}
