import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme } from './theme';

// jsdom has no matchMedia, so the system preference is passed in explicitly.
// The live re-resolve when the OS setting changes is pinned in
// e2e/settings.spec.ts against Chromium's real matchMedia.

const html = () => document.documentElement.dataset.theme;
const metaColors = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );

beforeEach(() => {
  // Mirrors index.html: a dark/light media pair, both #08090a/#fafaf8.
  document.head.innerHTML = `
    <meta name="theme-color" content="#08090a" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#fafaf8" media="(prefers-color-scheme: light)" />
  `;
  delete document.documentElement.dataset.theme;
});

describe('applyTheme', () => {
  it('follows a dark system preference when set to system', () => {
    expect(applyTheme('system', true)).toBe('dark');
    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });

  it('follows a light system preference when set to system', () => {
    expect(applyTheme('system', false)).toBe('light');
    expect(html()).toBe('light');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });

  it('forces light over a dark system preference, including the theme-color metas', () => {
    expect(applyTheme('light', true)).toBe('light');
    expect(html()).toBe('light');
    expect(metaColors()).toEqual(['#fafaf8', '#fafaf8']);
  });

  it('forces dark over a light system preference, including the theme-color metas', () => {
    expect(applyTheme('dark', false)).toBe('dark');
    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#08090a']);
  });

  it('restores the themed media pair when switching an override back to system', () => {
    applyTheme('light', true);

    applyTheme('system', true);

    expect(html()).toBe('dark');
    expect(metaColors()).toEqual(['#08090a', '#fafaf8']);
  });
});
