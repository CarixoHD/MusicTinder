import { expect, test, type Page } from '@playwright/test';
import { buildLink, type MusicApp } from '../src/links/links';
import type { LikedItem, Settings } from '../src/types';
import { mockCatalog } from './fixtures';

const APPS: readonly MusicApp[] = ['spotify', 'apple', 'ytmusic'];

const SETTINGS: Settings = {
  musicApp: 'spotify',
  sound: true,
  theme: 'system',
  cardType: 'artist',
};

// Newest last: the Liked list must show these in reverse.
const LIKES: LikedItem[] = [
  {
    key: 'dz:artist:5101',
    kind: 'artist',
    title: 'Glass Harbour',
    creator: 'Glass Harbour',
    creatorKey: 'glass harbour',
    chips: ['electronic', 'ambient'],
    because: 'Ada Vale',
  },
  {
    key: 'it:album:91011',
    kind: 'album',
    title: 'Ada Vale No. 1',
    creator: 'Ada Vale',
    creatorKey: 'ada vale',
    year: 2019,
    image: 'https://cdn.example.test/art/91011.jpg',
    appleUrl: 'https://music.apple.com/album/91011?uo=4',
    chips: ['electronic'],
    because: 'Ada Vale',
  },
  {
    key: 'dz:artist:5103',
    kind: 'artist',
    title: 'Neon Field',
    creator: 'Neon Field',
    creatorKey: 'neon field',
    image: 'https://cdn.example.test/artists/5103.jpg',
    chips: ['electronic', 'dance'],
    because: 'Ada Vale',
  },
];

const newestFirst = [...LIKES].reverse();

/** Persist a liked list the way the app would, then let the app boot from it. */
async function seedLikes(page: Page, musicApp: MusicApp = 'spotify'): Promise<void> {
  await page.addInitScript(
    ({ liked, settings }) => {
      localStorage.setItem(
        'mt:v1',
        JSON.stringify({
          state: {
            seeds: [],
            settings,
            taste: { chips: {}, creators: {}, origins: {} },
            liked,
            seen: [],
          },
          version: 1,
        }),
      );
    },
    { liked: LIKES, settings: { ...SETTINGS, musicApp } },
  );
}

const openLiked = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Liked' }).click();
};

test.beforeEach(async ({ page }) => {
  await mockCatalog(page);
});

test('likes list newest first with title, creator and a fixed 56 px thumb', async ({ page }) => {
  await seedLikes(page);
  await openLiked(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Liked' })).toBeVisible();

  const rows = page.locator('.liked-row-item');
  await expect(rows).toHaveCount(newestFirst.length);
  await expect(page.locator('.liked-row__title')).toHaveText(newestFirst.map((item) => item.title));

  for (const [index, item] of newestFirst.entries()) {
    const row = rows.nth(index);
    await expect(row).toContainText(item.creator);
    const thumb = row.locator('.liked-row__thumb');
    const box = await thumb.boundingBox();
    expect(box).toMatchObject({ width: 56, height: 56 });
  }

  // An artist row says what it is instead of repeating the name; an album row
  // names whose album it is.
  await expect(rows.nth(0).locator('.liked-row__creator')).toHaveText('Artist · Electronic');
  await expect(rows.nth(1).locator('.liked-row__creator')).toHaveText('Album · Ada Vale');
  // One accessible name, not the title repeated by every inner text node.
  await expect(rows.nth(0).locator('.liked-row')).toHaveAttribute(
    'aria-label',
    'Neon Field, Artist · Electronic, open in Spotify',
  );

  // The snapshot without artwork shows the neutral placeholder, not an empty box.
  await expect(rows.nth(2).locator('.liked-row__thumb svg')).toBeVisible();
  await expect(rows.nth(1)).toContainText('2019');
});

for (const app of APPS) {
  test(`each row's href is the ${app} link for the current musicApp`, async ({ page }) => {
    await seedLikes(page, app);
    await openLiked(page);

    const rows = page.locator('.liked-row');
    await expect(rows).toHaveCount(newestFirst.length);

    for (const [index, item] of newestFirst.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute('href', buildLink(item, app));
      await expect(row).toHaveAttribute('target', '_blank');
      await expect(row).toHaveAttribute('rel', 'noopener');
    }
  });
}

test('empty Liked explains itself and its button leads to Discover', async ({ page }) => {
  await page.goto('/');
  const tabbar = page.getByRole('navigation', { name: 'Main' });
  await tabbar.getByRole('button', { name: 'Liked' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Nothing saved yet' })).toBeVisible();
  await expect(page.getByText('Swipe a few cards and your finds collect here.')).toBeVisible();

  await page.getByRole('button', { name: 'Go to Discover' }).click();
  await expect(tabbar.getByRole('button', { name: 'Discover' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('?seedDemo=1 fills a fresh profile and lands on Discovery', async ({ page }) => {
  await page.goto('/?seedDemo=1');

  const tabbar = page.getByRole('navigation', { name: 'Main' });
  await expect(tabbar.getByRole('button', { name: 'Discover' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const stored = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state;
    return {
      artists: state.seeds.filter((seed: { kind: string }) => seed.kind === 'artist').length,
      albums: state.seeds.filter((seed: { kind: string }) => seed.kind === 'album').length,
      genres: state.seeds.filter((seed: { kind: string }) => seed.kind === 'genre').length,
      liked: state.liked.length,
    };
  });
  expect(stored).toMatchObject({ artists: 2, albums: 1, liked: 3 });
  expect(stored.genres).toBeGreaterThan(0);

  await tabbar.getByRole('button', { name: 'Liked' }).click();
  await expect(page.locator('.liked-row')).toHaveCount(3);
});
