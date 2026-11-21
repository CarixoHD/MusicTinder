import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { LikedItem, Seed } from '../src/types';
import { mockCatalog } from './fixtures';

// Accessibility pass for the three screens the PRD names, in both themes, plus
// the keyboard-only journey: Tab to a control, Enter to act, arrows to swipe.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const SEED: Seed = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

const LIKES: LikedItem[] = [
  {
    key: 'dz:artist:5101',
    kind: 'artist',
    title: 'Glass Harbour',
    creator: 'Glass Harbour',
    creatorKey: 'glass harbour',
    year: 2019,
    chips: ['electronic'],
    because: 'Ada Vale',
  },
  {
    key: 'it:track:91011',
    kind: 'song',
    title: 'Ada Vale song 1',
    creator: 'Ada Vale',
    creatorKey: 'ada vale',
    year: 2021,
    chips: ['electronic', 'ambient'],
    because: 'Ada Vale',
  },
];

interface PersistedOptions {
  cardType?: 'artist' | 'album' | 'song';
  seeds?: Seed[];
  liked?: LikedItem[];
}

/** Boot the app with a returning listener's persisted state. */
async function seedApp(page: Page, { cardType = 'album', seeds = [SEED], liked = [] }: PersistedOptions = {}): Promise<void> {
  await page.addInitScript(
    (json) => {
      try {
        localStorage.setItem('mt:v1', json);
      } catch {
        // about:blank has no storage; the navigation runs this again.
      }
    },
    JSON.stringify({
      state: {
        seeds,
        settings: { musicApp: 'spotify', sound: false, theme: 'system', cardType },
        taste: { chips: {}, creators: {}, origins: {} },
        liked,
        seen: [],
      },
      version: 1,
    }),
  );
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

const deckTitle = (page: Page) => page.locator('.deck__current .card__title');

const stored = (page: Page): Promise<{ liked: { title: string }[]; seen: string[] }> =>
  page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state;
    return { liked: state.liked, seen: state.seen };
  });

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test.beforeEach(async ({ page }) => {
      await mockCatalog(page, { enrichRelatedArtists: true });
    });

    test('Setup has no axe violations', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();

      // Populate every control state: a selected chip, a stored seed, an enabled primary.
      await page.getByRole('button', { name: 'Pop', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');
      await page.getByRole('button', { name: /Ada Vale/ }).click();
      await expect(page.getByRole('button', { name: 'Remove Ada Vale' })).toBeVisible();

      expect(await axeViolations(page)).toEqual([]);
    });

    test('Discovery has no axe violations', async ({ page }) => {
      await seedApp(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(deckTitle(page)).toHaveText(/\S/);
      await expect(page.locator('.deck__current .card__year')).toBeVisible();

      expect(await axeViolations(page)).toEqual([]);
    });

    test('Liked has no axe violations', async ({ page }) => {
      await seedApp(page, { seeds: [], liked: LIKES });
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);

      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Liked' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Liked' })).toBeVisible();
      await expect(page.locator('.liked-row')).toHaveCount(LIKES.length);

      expect(await axeViolations(page)).toEqual([]);
    });
  });
}

test('the inline retry row has no axe violations while cards stay on screen', async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await seedApp(page, { cardType: 'artist' });
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  let catalogDown = true;
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).host;
    if (catalogDown && (host === 'itunes.apple.com' || host === 'api.deezer.com')) {
      return route.abort('failed');
    }
    return route.fallback();
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible();
  catalogDown = false;

  expect(await axeViolations(page)).toEqual([]);
});

test('the stalled deck screen has no axe violations', async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await seedApp(page);

  let catalogDown = true;
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).host;
    if (catalogDown && (host === 'itunes.apple.com' || host === 'api.deezer.com')) {
      return route.abort('failed');
    }
    return route.fallback();
  });
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: "Couldn't reach the catalog" })).toBeVisible();
  catalogDown = false;

  expect(await axeViolations(page)).toEqual([]);
});

test('keyboard only: Tab adds a seed, starts the deck, then arrows like and skip', async ({
  page,
}) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await page.goto('/');

  const search = page.getByRole('searchbox', { name: 'Search artists' });
  // Tab past the header's settings button into the seed search.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.type('ada');

  const hit = page.getByRole('button', { name: /Ada Vale/ });
  await expect(hit).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(hit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Ada Vale' })).toBeVisible();

  // Walk to Start discovering with Tab alone, then start with Enter.
  const start = page.getByRole('button', { name: 'Start discovering' });
  for (let step = 0; step < 200 && !(await start.evaluate((el) => el === document.activeElement)); step += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(deckTitle(page)).toHaveText(/\S/);
  const liked = await deckTitle(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(deckTitle(page)).not.toHaveText(liked);
  expect((await stored(page)).liked.map((item) => item.title)).toContain(liked);

  const skipped = await deckTitle(page).innerText();
  const seenBefore = (await stored(page)).seen.length;
  await page.keyboard.press('ArrowLeft');
  await expect(deckTitle(page)).not.toHaveText(skipped);

  const afterSkip = await stored(page);
  expect(afterSkip.seen.length).toBe(seenBefore + 1);
  expect(afterSkip.liked.map((item) => item.title)).not.toContain(skipped);
});
