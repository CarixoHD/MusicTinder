import { expect, test, type Page } from '@playwright/test';
import { mockCatalog } from './fixtures';

// Story 15: catalog failures explain themselves inline, dealt cards keep
// working, and a retry — by button or on `online` — resumes the deck. Seeds
// that yield nothing say so instead of showing a broken empty deck.

const SEED = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

interface SeedOptions {
  seen?: string[];
  seed?: typeof SEED;
}

async function seedDeck(page: Page, { seen = [], seed = SEED }: SeedOptions = {}): Promise<void> {
  const persisted = {
    state: {
      seeds: [seed],
      settings: { musicApp: 'spotify', sound: false, theme: 'system', cardType: 'artist' },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
      seen,
    },
    version: 1,
  };
  await page.addInitScript((json) => {
    try {
      localStorage.setItem('mt:v1', json);
    } catch {
      // about:blank has no storage; the navigation runs this again.
    }
  }, JSON.stringify(persisted));
}

const deckTitle = (page: Page) => page.locator('.deck__current .card__title');

const stored = (page: Page): Promise<{ liked: string[]; seen: string[] }> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('mt:v1');
    const state = raw ? JSON.parse(raw).state : { liked: [], seen: [] };
    return { liked: state.liked.map((item: { title: string }) => item.title), seen: state.seen };
  });

const swipe = async (page: Page, key: 'ArrowRight' | 'ArrowLeft'): Promise<string> => {
  const before = await deckTitle(page).innerText();
  await page.keyboard.press(key);
  await expect(deckTitle(page)).not.toHaveText(before);
  return before;
};

/**
 * Pulls both catalog hosts at the network layer; the returned switch cuts them
 * (true) or restores the fixture routes (false).
 */
async function switchableCatalog(page: Page): Promise<(down: boolean) => void> {
  let down = false;
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).host;
    if (down && (host === 'itunes.apple.com' || host === 'api.deezer.com')) {
      return route.abort('failed');
    }
    return route.fallback();
  });
  return (next) => {
    down = next;
  };
}

test('a refill failure after the first deal keeps dealt cards swipeable with an inline Retry', async ({
  page,
}) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await seedDeck(page);
  const setCatalogDown = await switchableCatalog(page);

  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  // The network dies after the deck has dealt cards.
  setCatalogDown(true);

  await swipe(page, 'ArrowRight');
  await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible();

  // Already-dealt cards still like and skip; the failure never becomes a screen.
  await expect(page.getByRole('heading', { name: 'Your deck is getting ready' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: "That’s everything in this direction" })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeEnabled();

  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'] as const) {
    await swipe(page, key);
    await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible();
  }
  const afterOfflineSwipes = await stored(page);
  expect(afterOfflineSwipes.seen.length).toBeGreaterThanOrEqual(5);

  // The pool has drained below a full prefetch queue while the catalog was down.
  expect(await page.locator('.deck__upcoming .card').count()).toBeLessThan(3);

  // Restoring the catalog and pressing Retry runs a real refill and clears the row.
  setCatalogDown(false);
  const refillRequest = page.waitForRequest((request) =>
    request.url().includes('api.deezer.com/artist/4101/related'),
  );
  await page.getByRole('button', { name: 'Retry' }).click();
  await refillRequest;

  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
  await expect(deckTitle(page)).toHaveText(/\S/);
  await swipe(page, 'ArrowRight');
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
});

test('a first refill failure explains itself inline and Retry deals once the catalog is back', async ({
  page,
}) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await seedDeck(page);
  const setCatalogDown = await switchableCatalog(page);
  setCatalogDown(true);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: "Couldn’t reach the catalog" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your deck is getting ready' })).toHaveCount(0);
  await expect(page.locator('.deck__current')).toHaveCount(0);

  setCatalogDown(false);
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(deckTitle(page)).toHaveText(/\S/);
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
});

test('going back online retries the refill without a tap', async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await seedDeck(page);
  const setCatalogDown = await switchableCatalog(page);

  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);
  setCatalogDown(true);
  await swipe(page, 'ArrowRight');
  await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible();

  setCatalogDown(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
});

test('seeds with no candidates explain themselves and Change seeds returns to Setup', async ({
  page,
}) => {
  await mockCatalog(page);
  // No fixture artist is called Ghost Artist, so Deezer answers with nothing.
  await seedDeck(page, {
    seed: {
      id: 'seed-ghost',
      kind: 'artist',
      name: 'Ghost Artist',
      creatorKey: 'ghost artist',
      itunesArtistId: 9991,
      deezerArtistId: 9999,
      chips: [],
    },
  });

  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Nothing to recommend from these seeds yet' }),
  ).toBeVisible();
  await expect(page.locator('.deck__current')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your deck is getting ready' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fresh deck' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Change seeds' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
});
