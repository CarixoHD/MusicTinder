import { expect, test, type Page } from '@playwright/test';
import { mockCatalog, mockLongAlbumTitles } from './fixtures';

// Short viewports (a laptop window at 600/720 px tall, a small phone) are where
// the fixed tab bar used to swallow the like/skip buttons once a two-line title
// was on top. The deck's height cap has to win over any width floor.

const SEED = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

async function seedDeck(page: Page, cardType: 'artist' | 'album'): Promise<void> {
  const persisted = {
    state: {
      seeds: [SEED],
      settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
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

const title = (page: Page) => page.locator('.deck__current .card__title');

/** The rendered height and one line's line-height of the top card's title. */
const titleLines = async (page: Page): Promise<{ height: number; line: number }> =>
  title(page).evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    line: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));

test.beforeEach(async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
});

for (const viewport of [
  { width: 1280, height: 600 },
  { width: 1280, height: 720 },
  { width: 360, height: 640 },
]) {
  test(`with a two-line title on top, Like stays above the tab bar at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockLongAlbumTitles(page);
    await seedDeck(page, 'album');
    await page.goto('/');
    await expect(title(page)).toHaveText(/\S/);

    // The release suffix is stripped; the long title itself wraps. Deal on
    // until a wrapped title is on top, since that is the case that broke.
    let twoLine = false;
    for (let card = 0; card < 8 && !twoLine; card += 1) {
      const { height, line } = await titleLines(page);
      twoLine = height > line * 1.5;
      if (twoLine) break;
      const current = await title(page).innerText();
      await page.getByRole('button', { name: 'Skip', exact: true }).click();
      await expect(title(page)).not.toHaveText(current);
    }
    expect(twoLine, 'expected a two-line card title within the first 8 cards').toBe(true);

    const like = (await page.getByRole('button', { name: 'Like', exact: true }).boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
    expect(like.y + like.height).toBeLessThanOrEqual(nav.y);
  });
}

// The reviewer's phone case: a short name ("The BossHoss") that wraps at 34 px.
test('a short two-line title on a phone keeps Like above the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await seedDeck(page, 'artist');
  await page.goto('/');
  await expect(title(page)).toHaveText(/\S/);

  let twoLine = false;
  for (let card = 0; card < 8 && !twoLine; card += 1) {
    const { height, line } = await titleLines(page);
    twoLine = height > line * 1.5;
    if (twoLine) break;
    const current = await title(page).innerText();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(title(page)).not.toHaveText(current);
  }
  expect(twoLine, 'expected a two-line artist name within the first 8 cards').toBe(true);

  const like = (await page.getByRole('button', { name: 'Like', exact: true }).boundingBox())!;
  const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(like.y + like.height).toBeLessThanOrEqual(nav.y);
});
