import type { Settings } from '../types';

type Theme = Settings['theme'];
type ResolvedTheme = 'dark' | 'light';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The address-bar / status-bar colour for each resolved theme (DESIGN.md). */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#08090a',
  light: '#fafaf8',
};

function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme !== 'system') return theme;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Applies a theme to <html> and the theme-color metas, returning the resolved
 * dark/light. In system mode the two metas keep their prefers-color-scheme
 * pair; an override paints both so whichever one the browser matches is right.
 */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = resolved;

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const isLightMeta = (meta.getAttribute('media') ?? '').includes('light');
    meta.content =
      theme === 'system'
        ? (isLightMeta ? THEME_COLORS.light : THEME_COLORS.dark)
        : THEME_COLORS[resolved];
  }

  return resolved;
}

/** Applies the theme now and, while on system, follows live OS changes. */
export function watchTheme(theme: Theme): () => void {
  applyTheme(theme);
  if (theme !== 'system') return () => undefined;

  const query = window.matchMedia(DARK_QUERY);
  const onChange = () => applyTheme('system');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
