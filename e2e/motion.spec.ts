import { expect, test, type Page } from '@playwright/test';
import { mockCatalog } from './fixtures';

// Motion runs on the real deck, store and catalog composition; only the two
// network transports are mocked and state is seeded through the persisted key.

const SEED = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

const likedItem = (index: number) => ({
  key: `liked-${index}`,
  kind: 'artist',
  title: `Saved artist ${index}`,
  creator: 'Ada Vale',
  creatorKey: 'ada vale',
  chips: ['electronic'],
});

interface StoredState {
  liked: { key: string; title: string }[];
  seen: string[];
}

interface SeedOptions {
  cardType?: 'artist' | 'album' | 'song';
  liked?: ReturnType<typeof likedItem>[];
}

async function seedDeck(page: Page, { cardType = 'artist', liked = [] }: SeedOptions = {}): Promise<void> {
  const persisted = {
    state: {
      seeds: [SEED],
      settings: { musicApp: 'spotify', sound: false, theme: 'system', cardType },
      taste: { chips: {}, creators: {}, origins: {} },
      liked,
      seen: [],
    },
    version: 1,
  };
  await page.addInitScript((json) => {
    try {
      localStorage.setItem('mt:v1', json);
    } catch {
      // about:blank has no storage; the app navigation runs this again.
    }
  }, JSON.stringify(persisted));
}

const stored = (page: Page): Promise<StoredState | null> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('mt:v1');
    return raw ? (JSON.parse(raw) as { state: StoredState }).state : null;
  });

const deckTitle = (page: Page) => page.locator('.deck__current .card__title');
const swipeCard = (page: Page) => page.locator('.deck__current .swipe-card');

/** Drags the top card horizontally and releases. `slow` simulates a deliberate
 * drag so the velocity stays under the flick threshold. */
async function dragBy(
  page: Page,
  dx: number,
  { slow = false, steps = 12 }: { slow?: boolean; steps?: number } = {},
): Promise<void> {
  const box = await page.locator('.deck__current .card__art').boundingBox();
  if (!box) throw new Error('no dealt card to drag');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (dx * step) / steps, startY);
    if (slow) await page.waitForTimeout(25);
  }
}

/** Computed transform of the dragged card as a matrix, so rotation can be
 * asserted as the b/c terms rather than a string match. */
const cardMatrix = (page: Page) =>
  swipeCard(page).evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    const match = /matrix\(([^)]+)\)/.exec(transform);
    if (!match) return { b: 0, c: 0, tx: 0 };
    const [, b, c, , tx] = match[1].split(',').map(Number);
    return { b, c, tx };
  });

const opacityOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => Number(getComputedStyle(element).opacity));

const runningAnimations = (page: Page) =>
  page.evaluate(() => document.getAnimations().length);

test.beforeEach(async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
});

test('dragging the card right past the threshold likes it and deals the next card', async ({ page }) => {
  await seedDeck(page);
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);
  const first = await deckTitle(page).innerText();

  await dragBy(page, 220);

  // The label fades in with the drag direction.
  await expect.poll(() => opacityOf(page, '.swipe-label--like')).toBeGreaterThan(0.5);
  await expect.poll(() => opacityOf(page, '.swipe-label--skip')).toBeLessThan(0.1);

  await page.mouse.up();

  await expect.poll(async () => (await stored(page))?.liked.length ?? 0).toBe(1);
  const state = await stored(page);
  expect(state?.liked[0].title).toBe(first);
  await expect(deckTitle(page)).not.toHaveText(first);
});

test('a short, slow drag springs back without recording a reaction', async ({ page }) => {
  await seedDeck(page);
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);
  const first = await deckTitle(page).innerText();

  await dragBy(page, 40, { slow: true });
  await page.mouse.up();

  // The card settles back to its resting place.
  await expect.poll(async () => Math.abs((await cardMatrix(page)).tx)).toBeLessThan(1);
  expect(await deckTitle(page).innerText()).toBe(first);
  expect((await stored(page))?.liked).toHaveLength(0);
  expect((await stored(page))?.seen).toHaveLength(0);
});

test('the Like and Skip buttons and the arrow keys still react', async ({ page }) => {
  await seedDeck(page);
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);
  const first = await deckTitle(page).innerText();

  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect.poll(async () => (await stored(page))?.liked.length ?? 0).toBe(1);
  expect((await stored(page))?.seen).toHaveLength(1);

  const second = await deckTitle(page).innerText();
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await stored(page))?.seen.length ?? 0).toBe(2);
  expect((await stored(page))?.liked).toHaveLength(1);

  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect.poll(async () => (await stored(page))?.seen.length ?? 0).toBe(3);
});

test('reduced motion: a drag has no rotation and a like commits with the Like label', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedDeck(page);
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);
  const first = await deckTitle(page).innerText();

  await dragBy(page, 160);

  // Translation may follow the finger, but the card must not rotate.
  await expect.poll(async () => (await cardMatrix(page)).tx).toBeGreaterThan(80);
  const { b, c } = await cardMatrix(page);
  expect(Math.abs(b)).toBeLessThan(0.01);
  expect(Math.abs(c)).toBeLessThan(0.01);
  await expect.poll(() => opacityOf(page, '.swipe-label--like')).toBeGreaterThan(0.5);

  await page.mouse.up();

  // The on-card label is the confirmation; the like still lands in the store.
  await expect.poll(async () => (await stored(page))?.liked.length ?? 0).toBe(1);
  expect((await stored(page))?.liked[0].title).toBe(first);
  await expect(deckTitle(page)).not.toHaveText(first);
});

test('reduced motion: switching from Discover to Liked leaves no running animations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedDeck(page, { liked: [likedItem(1), likedItem(2), likedItem(3)] });
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  await page.getByRole('button', { name: 'Liked', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Liked' })).toBeVisible();
  await expect.poll(() => runningAnimations(page)).toBe(0);
});

test('Liked rows reveal with a 30 ms-per-row stagger', async ({ page }) => {
  await seedDeck(page, { liked: [likedItem(1), likedItem(2), likedItem(3)] });
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  await page.getByRole('button', { name: 'Liked', exact: true }).click();
  await expect(page.locator('.liked-row-item')).toHaveCount(3);

  const rows = await page.locator('.liked-row-item').evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item);
      const delay = style.animationDelay;
      return {
        name: style.animationName,
        delayMs: parseFloat(delay) * (delay.endsWith('ms') ? 1 : 1000),
      };
    }),
  );
  expect(rows.map((row) => row.name)).toEqual(['liked-row-in', 'liked-row-in', 'liked-row-in']);
  expect(rows.map((row) => row.delayMs)).toEqual([0, 30, 60]);
});
