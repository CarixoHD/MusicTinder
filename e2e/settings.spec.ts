import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockCatalog } from './fixtures';

// A returning listener's profile: one artist seed, one like and real taste,
// so Reset has something to wipe.
const SEEDED = {
  state: {
    seeds: [
      {
        id: 'it:artist:9101',
        kind: 'artist',
        name: 'Ada Vale',
        itunesArtistId: 9101,
        deezerArtistId: 4101,
        chips: ['electronic'],
        creatorKey: 'ada vale',
      },
    ],
    settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType: 'song' },
    taste: { chips: { electronic: 1 }, creators: { 'ada vale': 1 }, origins: { electronic: 'Ada Vale' } },
    liked: [
      {
        key: 'dz:artist:5101',
        kind: 'artist',
        title: 'Glass Harbour',
        creator: 'Glass Harbour',
        creatorKey: 'glass harbour',
        chips: ['electronic'],
        because: 'Ada Vale',
      },
    ],
    seen: ['it:track:910101'],
  },
  version: 1,
};

const metaColors = (page: Page): Promise<(string | null)[]> =>
  page
    .locator('meta[name="theme-color"]')
    .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content')));

const canvasColor = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const storedState = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mt:v1') ?? 'null')?.state ?? null);

const openSettings = async (page: Page) => {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test.beforeEach(async ({ page }) => {
  await mockCatalog(page);
});

test('choosing Light repaints the canvas and theme-color, and survives reload', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Light' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvasColor(page)).toBe('rgb(250, 250, 248)');
  expect(await metaColors(page)).toEqual(['#fafaf8', '#fafaf8']);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvasColor(page)).toBe('rgb(250, 250, 248)');

  const stored = await storedState(page);
  expect((stored?.settings as { theme?: string } | undefined)?.theme).toBe('light');
});

test('music app and sound choices persist and show in the reopened settings', async ({ page }) => {
  await page.goto('/');
  let dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Apple Music' }).click();
  await expect(dialog.getByRole('button', { name: 'Apple Music' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const sound = dialog.getByRole('switch', { name: 'Sound is on' });
  await sound.click();
  await expect(dialog.getByRole('switch', { name: 'Sound is off' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  await page.reload();
  dialog = await openSettings(page);

  await expect(dialog.getByRole('button', { name: 'Apple Music' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('button', { name: 'Spotify' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(dialog.getByRole('switch', { name: 'Sound is off' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('Reset asks first: cancel keeps the data, confirming wipes it and shows Setup', async ({
  page,
}) => {
  await page.addInitScript((profile) => {
    try {
      localStorage.setItem('mt:v1', profile);
    } catch {
      // about:blank has no storage; the script runs again on navigation.
    }
  }, JSON.stringify(SEEDED));
  await page.goto('/');
  const dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Reset all my data' }).click();
  await expect(
    dialog.getByText('This deletes your seeds, likes and taste on this device.'),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('button', { name: 'Reset all my data' })).toBeVisible();
  const kept = await storedState(page);
  expect(kept?.seeds).toHaveLength(1);
  expect(kept?.liked).toHaveLength(1);

  await dialog.getByRole('button', { name: 'Reset all my data' }).click();
  await dialog.getByRole('button', { name: 'Delete everything' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();

  const cleared = await storedState(page);
  expect(cleared?.seeds).toEqual([]);
  expect(cleared?.liked).toEqual([]);
  expect(cleared?.taste).toEqual({ chips: {}, creators: {}, origins: {} });
});

test('Escape and a backdrop tap close the sheet and return focus to its opener', async ({
  page,
}) => {
  await page.goto('/');
  const settingsTab = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Settings', exact: true });

  await settingsTab.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settingsTab).toBeFocused();

  await settingsTab.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.locator('.sheet-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settingsTab).toBeFocused();
});

test('the open sheet meets WCAG AA colour contrast in dark and light', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const dark = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .include('.sheet')
    .analyze();
  expect(dark.violations).toEqual([]);

  const lightButton = dialog.getByRole('button', { name: 'Light' });
  await lightButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The colour tokens cross-fade for 120 ms; scan once the selected button has settled.
  await expect(lightButton).toHaveCSS('color', 'rgb(79, 86, 199)');
  await expect(lightButton).toHaveCSS('background-color', 'rgba(79, 86, 199, 0.1)');

  const light = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .include('.sheet')
    .analyze();
  expect(light.violations).toEqual([]);
});
