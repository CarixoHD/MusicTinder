import { expect, test, type Page, type Route } from '@playwright/test';
import { mockCatalog } from './fixtures';

// Discovery runs the real store and the real catalog composition; only the two
// network transports are mocked. State is seeded the same way a returning
// listener would have it: persisted under mt:v1.

const SEED = {
  id: 'seed-ada',
  kind: 'artist',
  name: 'Ada Vale',
  creatorKey: 'ada vale',
  itunesArtistId: 9101,
  deezerArtistId: 4101,
  chips: ['electronic', 'ambient'],
};

/** Every related-artist key the Ada Vale fixture can deal. */
const RELATED_KEYS = [5101, 5102, 5103, 5104, 5105, 5106, 5107, 5108].map(
  (id) => `dz:artist:${id}`,
);

interface StoredState {
  liked: { key: string; title: string; creator: string }[];
  seen: string[];
  taste: { chips: Record<string, number>; creators: Record<string, number> };
}

interface SeedOptions {
  cardType?: 'artist' | 'album' | 'song';
  seen?: string[];
}

async function seedDeck(page: Page, { cardType = 'artist', seen = [] }: SeedOptions = {}): Promise<void> {
  const persisted = {
    state: {
      seeds: [SEED],
      settings: { musicApp: 'spotify', sound: true, theme: 'system', cardType },
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

test.beforeEach(async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
});

test('deals a card with artwork, title, creator, year, chips and a because line, and prefetches the next cards', async ({
  page,
}) => {
  await seedDeck(page, { cardType: 'album' });
  await page.goto('/');

  const current = page.locator('.deck__current');
  const artwork = current.getByRole('img');
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute('alt', / — /);
  await expect(current.getByRole('heading', { level: 2 })).toHaveText(/\S/);
  await expect(current.locator('.card__creator')).toHaveText(/\S/);
  await expect(current.locator('.card__year')).toHaveText(/^\d{4}$/);
  await expect(current.locator('.tag')).not.toHaveCount(0);
  await expect(current.locator('.card__because')).toContainText(/because you like/i);

  // At least three upcoming cards are already in the DOM behind the current one.
  expect(await page.locator('.deck__upcoming .card').count()).toBeGreaterThanOrEqual(3);

  // The like/skip controls are 56 px glass buttons with accessible names.
  for (const name of ['Skip', 'Like']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).toMatchObject({ width: 56, height: 56 });
  }
});

test('likes and skips by arrow key and by button, recording each reaction and dealing the next card', async ({
  page,
}) => {
  await seedDeck(page);
  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  // → likes.
  const first = await deckTitle(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(deckTitle(page)).not.toHaveText(first);
  let state = await stored(page);
  expect(state?.liked).toHaveLength(1);
  expect(state?.liked[0].title).toBe(first);
  expect(state?.seen).toContain(state?.liked[0].key);

  // The Like button likes.
  const second = await deckTitle(page).innerText();
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await expect(deckTitle(page)).not.toHaveText(second);
  state = await stored(page);
  expect(state?.liked).toHaveLength(2);
  expect(state?.liked[1].title).toBe(second);

  // The Skip button skips without adding a like.
  const third = await deckTitle(page).innerText();
  const seenBeforeSkip = state?.seen.length ?? 0;
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(deckTitle(page)).not.toHaveText(third);
  state = await stored(page);
  expect(state?.liked).toHaveLength(2);
  expect(state?.seen.length).toBe(seenBeforeSkip + 1);

  // ← skips too.
  const fourth = await deckTitle(page).innerText();
  const seenBeforeArrow = state?.seen.length ?? 0;
  await page.keyboard.press('ArrowLeft');
  await expect(deckTitle(page)).not.toHaveText(fourth);
  state = await stored(page);
  expect(state?.liked).toHaveLength(2);
  expect(state?.seen.length).toBe(seenBeforeArrow + 1);
});

test('ends quietly when nothing unseen is left and Change seeds returns to Setup', async ({ page }) => {
  await seedDeck(page, { seen: RELATED_KEYS });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: "That's everything in this direction" }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fresh deck' })).toBeVisible();

  await page.getByRole('button', { name: 'Change seeds' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
});

/** Flips both catalog hosts between failing and answering the fixture mocks. */
async function switchCatalog(page: Page, state: { offline: boolean }): Promise<void> {
  const handler = async (route: Route) => {
    if (state.offline) await route.abort('failed');
    else await route.fallback();
  };
  await page.route('https://itunes.apple.com/**', handler);
  await page.route('https://api.deezer.com/**', handler);
}

test('shows the catalog failure with a retry, not the deck-end screen, when the first refill fails', async ({
  page,
}) => {
  await seedDeck(page);
  const network = { offline: true };
  await switchCatalog(page, network);
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: "Couldn't reach the catalog" }),
  ).toBeVisible();
  // The listener has not run out of seeds; the deck never loaded.
  await expect(page.getByRole('heading', { name: "That's everything in this direction" })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Fresh deck' })).toHaveCount(0);

  network.offline = false;
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(deckTitle(page)).toHaveText(/\S/);
});

test('keeps the cards in hand swipeable and offers a retry when a background refill fails', async ({
  page,
}) => {
  await seedDeck(page);
  const network = { offline: false };
  await switchCatalog(page, network);

  await page.goto('/');
  await expect(deckTitle(page)).toHaveText(/\S/);

  // The first pool is below MIN_POOL, so the next commit refills in the
  // background; with the catalog down that refill rejects.
  network.offline = true;
  const first = await deckTitle(page).innerText();
  await page.keyboard.press('ArrowRight');
  await expect(deckTitle(page)).not.toHaveText(first);
  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible();

  // The card in hand stays swipeable underneath the notice.
  const second = await deckTitle(page).innerText();
  await page.keyboard.press('ArrowLeft');
  await expect(deckTitle(page)).not.toHaveText(second);
  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible();

  network.offline = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("Couldn't reach the catalog")).toBeHidden();
});
