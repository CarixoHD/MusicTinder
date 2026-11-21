// Live reduced-motion preference. Read the media query on every call (never a
// load-time capture) and subscribe to its changes so motion can follow the OS
// setting without a reload.
const QUERY = '(prefers-reduced-motion: reduce)';

const mediaQuery = (): MediaQueryList | null =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(QUERY);

export function prefersReducedMotion(): boolean {
  return mediaQuery()?.matches ?? false;
}

export function onReducedMotionChange(callback: (reduced: boolean) => void): () => void {
  const query = mediaQuery();
  if (!query) return () => undefined;

  const handleChange = (event: MediaQueryListEvent) => callback(event.matches);
  query.addEventListener('change', handleChange);
  return () => query.removeEventListener('change', handleChange);
}
