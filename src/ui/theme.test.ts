import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, watchTheme } from './theme';

/** Controllable stand-in for the OS preference media query. */
class FakeMediaQueryList extends EventTarget {
  matches: boolean;
  readonly media = '(prefers-color-scheme: dark)';

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  setDark(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

let media: FakeMediaQueryList;

const html = () => document.documentElement.dataset.theme;
const metaColors = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );

beforeEach(() => {
  media = new FakeMediaQueryList(true);
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  // Mirrors index.html: a dark/light media pair, both #08090a/#fafaf8.
  document.head.innerHTML = `
    <meta name="theme-color" content="#08090a" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#fafaf8" media="(prefers-color-scheme: light)" />
  `;
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyTheme', () => {
  it('follows a dark system preference when set to system', () => {
    media.matches = true;

    expect(applyTheme('system')).toBe('dark');
    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });

  it('follows a light system preference when set to system', () => {
    media.matches = false;

    expect(applyTheme('system')).toBe('light');
    expect(html()).toBe('light');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });

  it('forces light over a dark system preference, including the theme-color metas', () => {
    media.matches = true;

    expect(applyTheme('light')).toBe('light');
    expect(html()).toBe('light');
    expect(metaColors()).toEqual(['#fafaf8', '#fafaf8']);
  });

  it('forces dark over a light system preference, including the theme-color metas', () => {
    media.matches = false;

    expect(applyTheme('dark')).toBe('dark');
    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#08090a']);
  });
});

describe('watchTheme', () => {
  it('re-applies the system theme when the OS setting changes', () => {
    media.matches = false;
    watchTheme('system');
    expect(html()).toBe('light');

    media.setDark(true);

    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });

  it('stops listening once the watch is torn down', () => {
    media.matches = false;
    const stop = watchTheme('system');
    stop();

    media.setDark(true);

    expect(html()).toBe('light');
  });

  it('ignores OS changes while a theme is forced', () => {
    media.matches = false;
    watchTheme('dark');

    media.setDark(false);

    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#08090a']);
  });
});
