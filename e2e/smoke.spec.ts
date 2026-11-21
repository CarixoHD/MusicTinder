import { expect, test } from '@playwright/test';
import { mockCatalog } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockCatalog(page);
});

test('a fresh profile opens the setup shell on the dark canvas', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();

  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(canvas).toBe('rgb(8, 9, 10)');

  const tabbar = page.getByRole('navigation', { name: 'Main' });
  await expect(tabbar).toBeVisible();
  await expect(tabbar.getByRole('button', { name: 'Discover' })).toBeVisible();
  await expect(tabbar.getByRole('button', { name: 'Liked' })).toBeVisible();
  await expect(tabbar.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
});

test('index.html links the manifest and the apple-touch-icon', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
});

test('the manifest is served and parses', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);

  const manifest: unknown = await response.json();
  expect(manifest).toMatchObject({
    name: 'Music Tinder',
    short_name: 'Music Tinder',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    theme_color: '#08090a',
    background_color: '#08090a',
  });
  expect(manifest).toMatchObject({
    icons: expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512' }),
      expect.objectContaining({ purpose: 'maskable' }),
    ]),
  });

  for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png']) {
    expect((await page.request.get(icon)).ok()).toBe(true);
  }
});

test('mockCatalog serves both transports', async ({ page }) => {
  await page.goto('/');

  const itunes = await page.evaluate(async () => {
    const response = await fetch('https://itunes.apple.com/search?term=ada&entity=artist');
    return response.json();
  });
  expect(itunes).toMatchObject({ resultCount: 1, results: [{ artistName: 'Ada Vale' }] });

  const deezer = await page.evaluate(async () => {
    const response = await fetch('https://api.deezer.com/search/artist?q=static&callback=cb');
    return response.text();
  });
  expect(deezer.startsWith('cb(')).toBe(true);
  expect(deezer).toContain('North Static');
});

test('repairs corrupt saved data with an inline notice instead of a blank page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('mt:v1', JSON.stringify({ state: { seeds: null, settings: {} }, version: 1 }));
  });

  await page.reload();

  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
  const notice = page.getByRole('status').filter({ hasText: 'saved data' });
  await expect(notice).toBeVisible();

  const repaired = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state;
    return { seeds: state.seeds, settings: state.settings };
  });
  expect(repaired).toEqual({
    seeds: [],
    settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType: 'artist' },
  });

  await notice.getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(notice).toBeHidden();

  // The bad value was overwritten, so the next launch is clean.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('the tabs move between screens and open the settings sheet', async ({ page }) => {
  await page.goto('/');
  const tabbar = page.getByRole('navigation', { name: 'Main' });

  await tabbar.getByRole('button', { name: 'Liked' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing saved yet' })).toBeVisible();

  await tabbar.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
