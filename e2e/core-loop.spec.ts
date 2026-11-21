import { expect, test, type Page } from '@playwright/test';
import { mockCatalog } from './fixtures';

// The PRD's definition-of-done loop, once, for real: cold start → seed → deal →
// play/pause → like → Liked → reload → still there. Both catalog transports and
// the preview host are mocked at the network layer; the app runs its own store,
// deck, player and screens.

const HOSTS = new Set([
  '127.0.0.1',
  'itunes.apple.com',
  'api.deezer.com',
  'cdn.example.test',
  'audio.example.test',
]);

const deckTitle = (page: Page) => page.locator('.deck__current .card__title');

const anyAudioPlaying = (page: Page): Promise<boolean> =>
  page.evaluate(() => [...document.querySelectorAll('audio')].some((element) => !element.paused));

interface Stored {
  seeds: { id: string; name: string }[];
  liked: { key: string; title: string }[];
  taste: { chips: Record<string, number>; creators: Record<string, number> };
  seen: string[];
}

const stored = (page: Page): Promise<Stored> =>
  page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('mt:v1') ?? '{}') as { state: Stored };
    return parsed.state;
  });

test.beforeEach(async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true, playAudio: true });
});

test('cold start to a saved like survives a reload with seeds and taste intact', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!HOSTS.has(host)) externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();

  // Songs carry previews, so the sample control can play.
  await page.getByRole('button', { name: 'Songs' }).click();
  await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');
  await page.getByRole('button', { name: /Ada Vale/ }).click();
  await page.getByRole('button', { name: 'Start discovering' }).click();

  // The deck deals.
  const current = page.locator('.deck__current');
  await expect(deckTitle(page)).toHaveText(/\S/);
  const firstTitle = await deckTitle(page).innerText();

  // Play, then pause: audio really starts and really stops.
  await expect(current.getByRole('button', { name: 'Play sample' })).toBeVisible();
  await current.getByRole('button', { name: 'Play sample' }).click();
  await expect(current.getByRole('button', { name: 'Pause sample' })).toBeVisible();
  await expect.poll(() => anyAudioPlaying(page)).toBe(true);
  await current.getByRole('button', { name: 'Pause sample' }).click();
  await expect(current.getByRole('button', { name: 'Play sample' })).toBeVisible();
  await expect.poll(() => anyAudioPlaying(page)).toBe(false);

  // → likes the card; the item lands in Liked.
  await page.keyboard.press('ArrowRight');
  await expect(deckTitle(page)).not.toHaveText(firstTitle);

  const tabbar = page.getByRole('navigation', { name: 'Main' });
  await tabbar.getByRole('button', { name: 'Liked' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Liked' })).toBeVisible();
  await expect(page.locator('.liked-row-item').filter({ hasText: firstTitle })).toBeVisible();

  const before = await stored(page);
  expect(before.liked.map((item) => item.title)).toEqual([firstTitle]);
  expect(before.seeds).toHaveLength(1);
  expect(Object.keys(before.taste.chips).length).toBeGreaterThan(0);

  // Reload: the likes, seeds and taste are still there; the deck deals again.
  await page.reload();
  await expect(deckTitle(page)).toHaveText(/\S/);

  const after = await stored(page);
  expect(after.taste).toEqual(before.taste);
  expect(after.seeds).toEqual(before.seeds);
  expect(after.liked).toEqual(before.liked);
  await expect(tabbar.getByRole('button', { name: 'Liked' })).toBeVisible();

  // …and the loop keeps working: one more like.
  const secondTitle = await deckTitle(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(deckTitle(page)).not.toHaveText(secondTitle);

  const later = await stored(page);
  expect(later.liked.map((item) => item.title)).toEqual([firstTitle, secondTitle]);
  expect(later.seen).toContain(later.liked[1].key);
  expect(Object.keys(later.taste.chips).length).toBeGreaterThan(0);

  // Nothing outside the mocked catalog/preview hosts was ever contacted.
  expect(externalRequests).toEqual([]);
});

test('an iTunes cool-down at deal time leaves a retry, not a seeds problem', async ({ page }) => {
  // The seed search answers; every later iTunes request is refused, so the
  // albums deck's enrichment is cooling down by the time it deals.
  await mockCatalog(page, {
    search: (_params, call) => (call > 1 ? { status: 429 } : undefined),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();

  // An albums deck needs iTunes enrichment, which spends the same ~17/min budget.
  await page.getByRole('button', { name: 'Albums' }).click();
  await page
    .getByRole('radiogroup', { name: 'Search scope' })
    .getByRole('radio', { name: 'Albums' })
    .check();
  const search = page.getByRole('searchbox', { name: 'Search albums' });
  await search.fill('ada');
  await page.getByRole('button', { name: /Ada Vale/ }).click();
  await expect(page.getByRole('button', { name: 'Remove Ada Vale No. 1' })).toBeVisible();

  await page.getByRole('button', { name: 'Start discovering' }).click();

  // The cool-down is a failure the listener can retry, not "nothing here".
  await expect(
    page.getByRole('heading', { level: 1, name: "Couldn’t reach the catalog" }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Nothing to recommend from these seeds yet' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change seeds' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your deck is getting ready' })).toHaveCount(0);
});
