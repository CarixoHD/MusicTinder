import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockPlaybackCatalog, seedSongDeck } from '../src/audio/playback-fixture';
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

const anyAudioPlaying = (page: Page): Promise<boolean> =>
  page.evaluate(() => [...document.querySelectorAll('audio')].some((element) => !element.paused));

/** Ten silent seconds, so the sample is still playing when the sheet is open. */
function longSilentWav(): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate * 10;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

const storedState = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mt:v1') ?? 'null')?.state ?? null);

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
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

test('the system theme follows the OS setting live', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Real matchMedia in Chromium: emulateMedia changes the OS preference.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await canvasColor(page)).toBe('rgb(250, 250, 248)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await canvasColor(page)).toBe('rgb(8, 9, 10)');
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

test('the sound switch shows its value in the track, not only in the label', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  // The name flips with the state, so match either; the track element stays put.
  const track = dialog
    .getByRole('switch', { name: /^Sound is (on|off)$/ })
    .locator('.switch__track');

  await expect
    .poll(() => track.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgb(139, 143, 240)');

  await dialog.getByRole('switch', { name: 'Sound is on' }).click();
  await expect(dialog.getByRole('switch', { name: 'Sound is off' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  // Off: a neutral hairline track with the thumb back at the start.
  await expect
    .poll(() => track.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgba(0, 0, 0, 0)');
  await expect
    .poll(() => track.evaluate((el) => getComputedStyle(el).borderTopColor))
    .toBe('rgba(255, 255, 255, 0.08)');
  await expect
    .poll(() =>
      track.locator('.switch__thumb').evaluate((el) => getComputedStyle(el).transform),
    )
    .toBe('none');
});

test('the Something different switch flips wildcards and persists across reload', async ({
  page,
}) => {
  await page.goto('/');
  let dialog = await openSettings(page);

  const wildcards = dialog.getByRole('switch', { name: 'Something different' });
  await expect(wildcards).toHaveAttribute('aria-checked', 'true');
  await expect(
    dialog.getByText('Now and then, a card outside your usual genres.'),
  ).toBeVisible();

  await wildcards.click();
  await expect(dialog.getByRole('switch', { name: 'Something different' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect((await storedState(page))?.settings).toMatchObject({ wildcards: false });

  await page.reload();
  dialog = await openSettings(page);
  await expect(dialog.getByRole('switch', { name: 'Something different' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('Edit seeds in Settings returns to Setup with the current seeds kept', async ({ page }) => {
  await page.addInitScript((profile) => {
    try {
      localStorage.setItem('mt:v1', profile);
    } catch {
      // about:blank has no storage; the script runs again on navigation.
    }
  }, JSON.stringify(SEEDED));
  await page.goto('/');
  const dialog = await openSettings(page);

  await dialog.getByRole('button', { name: 'Edit seeds' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Ada Vale' })).toBeVisible();
});

test('turning Sound off stops the sample that is playing', async ({ page }) => {
  // A real audio route and a song deck, on top of the default catalog fixture.
  const wav = longSilentWav();
  await mockPlaybackCatalog(page);
  await page.route('https://audio.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(wav.length),
        'accept-ranges': 'bytes',
      },
      body: wav,
    }),
  );
  await seedSongDeck(page);
  await page.goto('/');

  const current = page.locator('.deck__current');
  await expect(current.locator('.card__title')).toHaveText('Glass Harbour song 1');
  await current.getByRole('button', { name: 'Play sample' }).click();
  await expect.poll(() => anyAudioPlaying(page)).toBe(true);

  const dialog = await openSettings(page);
  await dialog.getByRole('switch', { name: 'Sound is on' }).click();
  await expect(dialog.getByRole('switch', { name: 'Sound is off' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // The sample behind the sheet is muted, stopped, and the card reads as paused.
  await expect.poll(() => anyAudioPlaying(page)).toBe(false);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].every((a) => a.muted)))
    .toBe(true);
  await expect(current.getByRole('button', { name: 'Play sample' })).toBeVisible();

  await dialog.getByRole('switch', { name: 'Sound is off' }).click();
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('audio')].every((a) => !a.muted)))
    .toBe(true);
  await expect.poll(() => anyAudioPlaying(page)).toBe(false);
});

test('Reset reads as the danger action, not as another primary button', async ({ page }) => {
  await page.goto('/');
  const dialog = await openSettings(page);
  const style = (name: string) =>
    dialog.getByRole('button', { name }).evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
    }));

  const reset = dialog.getByRole('button', { name: 'Reset all my data' });
  await expect(reset).toBeVisible();
  // Secondary weight like Edit seeds, but the reset-only danger colour.
  const resetStyle = await style('Reset all my data');
  expect(resetStyle.background).toBe((await style('Edit seeds')).background);
  expect(resetStyle.color).toBe('rgb(229, 101, 79)');

  await reset.click();

  // Confirming is the one filled danger button, with canvas-coloured text.
  const deleteStyle = await style('Delete everything');
  expect(deleteStyle.background).toBe('rgb(229, 101, 79)');
  expect(deleteStyle.color).toBe('rgb(8, 9, 10)');

  // Cancel and Delete share the content width as a two-column pair.
  const cancelBox = (await dialog.getByRole('button', { name: 'Cancel' }).boundingBox())!;
  const deleteBox = (await dialog.getByRole('button', { name: 'Delete everything' }).boundingBox())!;
  expect(cancelBox.width).toBeCloseTo(deleteBox.width, 0);
  expect(cancelBox.y).toBeCloseTo(deleteBox.y, 0);
  expect(cancelBox.x).toBeLessThan(deleteBox.x);
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
  const settingsButton = page.getByRole('button', { name: 'Open settings' });

  await settingsButton.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(
    await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settingsButton).toBeFocused();

  await settingsButton.click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.locator('.sheet-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settingsButton).toBeFocused();
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
