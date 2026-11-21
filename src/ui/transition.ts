import { prefersReducedMotion } from './motion';
import './transition.css';

const FALLBACK_MS = 120;
const SCREEN_FADE_CLASS = 'screen-fade';

interface TransitionOptions {
  /** Overrides the live media query; used by unit tests and never by the app. */
  reducedMotion?: boolean;
  /** Overrides document.startViewTransition when present (tests). */
  startViewTransition?: (update: () => void) => unknown;
}

/**
 * Runs a screen change with the house transition: the View Transitions API
 * (240 ms cross-fade + 12 px rise, see transition.css) when available, a short
 * cross-fade otherwise, and instant under reduced motion.
 */
export function withTransition(update: () => void, options: TransitionOptions = {}): void {
  if (options.reducedMotion ?? prefersReducedMotion()) {
    update();
    return;
  }

  const start = options.startViewTransition ?? document.startViewTransition?.bind(document);
  if (start) {
    start(update);
    return;
  }

  const root = document.documentElement;
  root.classList.add(SCREEN_FADE_CLASS);
  update();
  window.setTimeout(() => root.classList.remove(SCREEN_FADE_CLASS), FALLBACK_MS);
}
