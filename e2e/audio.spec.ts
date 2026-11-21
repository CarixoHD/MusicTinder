import { expect, test, type Page } from '@playwright/test';
import { mockPlaybackCatalog, seedSongDeck } from '../src/audio/playback-fixture';

// Card playback journey. Both catalog transports and the preview host are
// mocked at the network layer (see playback-fixture); the app runs its real
// player, store and deck.

const anyAudioPlaying = (page: Page): Promise<boolean> =>
  page.evaluate(() => [...document.querySelectorAll('audio')].some((element) => !element.paused));

const deckTitle = (page: Page) => page.locator('.deck__current .card__title');

test.beforeEach(async ({ page }) => {
  await mockPlaybackCatalog(page);
  await seedSongDeck(page);
});

test('tapping play starts the sample and tapping again pauses it', async ({ page }) => {
  await page.goto('/');
  const current = page.locator('.deck__current');
  await expect(deckTitle(page)).toHaveText('Glass Harbour song 1');

  await current.getByRole('button', { name: 'Play sample' }).click();
  await expect(current.getByRole('button', { name: 'Pause sample' })).toBeVisible();
  await expect.poll(() => anyAudioPlaying(page)).toBe(true);

  await current.getByRole('button', { name: 'Pause sample' }).click();
  await expect(current.getByRole('button', { name: 'Play sample' })).toBeVisible();
  await expect.poll(() => anyAudioPlaying(page)).toBe(false);
});

test('the sample progress draws as a 2 px ring around the play circle', async ({ page }) => {
  await page.goto('/');
  const current = page.locator('.deck__current');
  await expect(deckTitle(page)).toHaveText('Glass Harbour song 1');

  const ring = current.locator('.play-button__ring');
  await expect(ring).toBeVisible();
  // The promoted card's entry spring scales the whole card; wait for it to settle.
  await expect
    .poll(async () => (await ring.boundingBox())?.width ?? 0)
    .toBeCloseTo(48, 0);
  expect((await ring.boundingBox())!.height).toBeCloseTo(48, 0);

  const progress = current.locator('.play-button__ring-progress');
  const circumference = 2 * Math.PI * 22;
  const offset = () =>
    progress.evaluate((element) => Number.parseFloat(element.getAttribute('stroke-dashoffset') ?? 'NaN'));
  expect(await offset()).toBeCloseTo(circumference, 0);

  await current.getByRole('button', { name: 'Play sample' }).click();
  await expect.poll(async () => (await offset()) < circumference / 2).toBe(true);
});

test('a like with sound on starts the next card without another tap', async ({ page }) => {
  await page.goto('/');
  const current = page.locator('.deck__current');
  await expect(deckTitle(page)).toHaveText('Glass Harbour song 1');

  await page.getByRole('button', { name: 'Like', exact: true }).click();

  await expect(deckTitle(page)).toHaveText('Glass Harbour song 2');
  await expect(current.getByRole('button', { name: 'Pause sample' })).toBeVisible();
  await expect.poll(() => anyAudioPlaying(page)).toBe(true);
});

test('a card without a preview shows No sample and can still be liked', async ({ page }) => {
  await page.goto('/');
  const current = page.locator('.deck__current');
  const like = page.getByRole('button', { name: 'Like', exact: true });
  await expect(deckTitle(page)).toHaveText('Glass Harbour song 1');

  await like.click();
  await expect(deckTitle(page)).toHaveText('Glass Harbour song 2');
  await like.click();

  await expect(deckTitle(page)).toHaveText('Glass Harbour song 3');
  await expect(current.getByText('No sample', { exact: true })).toBeVisible();

  await like.click();
  await expect(deckTitle(page)).not.toHaveText('Glass Harbour song 3');

  const liked = await page.evaluate(() => {
    const raw = localStorage.getItem('mt:v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state: { liked: { title: string }[] } };
    return parsed.state.liked.map((item) => item.title);
  });
  expect(liked).toContain('Glass Harbour song 3');
});
