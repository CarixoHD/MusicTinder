import { prefersReducedMotion } from './motion';
import './transition.css';

const FALLBACK_MS = 120;
const SCREEN_FADE_CLASS = 'screen-fade';

/**
 * Runs a screen change with the house transition: the View Transitions API
 * (240 ms cross-fade + 12 px rise, see transition.css) when available, a short
 * cross-fade otherwise, and instant under reduced motion.
 */
export function withTransition(update: () => void): void {
  if (prefersReducedMotion()) {
    update();
    return;
  }

  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(update);
    return;
  }

  const root = document.documentElement;
  root.classList.add(SCREEN_FADE_CLASS);
  update();
  window.setTimeout(() => root.classList.remove(SCREEN_FADE_CLASS), FALLBACK_MS);
}
