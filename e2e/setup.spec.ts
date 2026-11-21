import { expect, test, type Page } from '@playwright/test';
import { mockCatalog } from './fixtures';

const ACCENT = 'rgb(139, 143, 240)';
const ACCENT_SUBTLE = 'rgba(139, 143, 240, 0.14)';

const storedSeeds = (page: Page): Promise<unknown> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state?.seeds ?? []);

const storedCardType = (page: Page): Promise<unknown> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state?.settings?.cardType);

test('typing shows artists from Deezer and picking one stores its Deezer seed, then fills iTunes details', async ({
  page,
}) => {
  const itunesSearches: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('itunes.apple.com/search')) itunesSearches.push(request.url());
  });
  await mockCatalog(page);
  await page.goto('/');

  const input = page.getByRole('searchbox', { name: 'Search artists' });
  await input.fill('ada');
  const result = page.getByRole('button', { name: /Ada Vale/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('18k fans');
  // Typing spent no iTunes token: the deck keeps its ~17/min budget.
  expect(itunesSearches).toEqual([]);

  await result.click();
  await expect(page.getByRole('button', { name: 'Remove Ada Vale' })).toBeVisible();

  // The seed lands on ['other'] and gets its chips + iTunes id off the pick path.
  await expect.poll(() => storedSeeds(page)).toMatchObject([
    {
      kind: 'artist',
      name: 'Ada Vale',
      deezerArtistId: 4101,
      itunesArtistId: 9101,
      chips: ['electronic'],
    },
  ]);
});

test('the album picker stores an album seed with its collection id', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Albums' }).click();
  const input = page.getByRole('searchbox', { name: 'Search albums' });
  await input.fill('ada');

  await page.getByRole('button', { name: /Ada Vale No\. 1/ }).click();

  expect(await storedSeeds(page)).toMatchObject([
    { kind: 'album', name: 'Ada Vale No. 1', itunesCollectionId: 91011 },
  ]);
});

test('an in-flight response for an older term never renders under the latest term', async ({
  page,
}) => {
  // Deezer searches are independent, so "ada" answers after 800 ms and "north"
  // seconds later: the stale "ada" answer must not render.
  await mockCatalog(page, {
    deezerSearch: (params) =>
      params.get('q') === 'ada' ? { delayMs: 800 } : { delayMs: 6_000 },
  });
  await page.goto('/');

  const input = page.getByRole('searchbox', { name: 'Search artists' });
  await input.fill('ada');
  await page.waitForRequest(
    (request) =>
      request.url().includes('api.deezer.com/search/artist') && request.url().includes('q=ada'),
  );
  const slowAda = page.waitForResponse(
    (response) =>
      response.url().includes('api.deezer.com/search/artist') && response.url().includes('q=ada'),
  );

  await input.fill('north');

  await slowAda;
  await expect(page.getByRole('button', { name: /Ada Vale/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /North Static/ })).toBeVisible({ timeout: 10_000 });
});

test('a term with no hits shows an inline no-match row', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/');

  await page.getByRole('searchbox', { name: 'Search artists' }).fill('zzz');

  await expect(page.getByText('No match for ‘zzz’')).toBeVisible();
});

test('a failed search explains itself inline and Retry runs it again', async ({ page }) => {
  // Deezer first, then the iTunes fallback: both must fail for the error row.
  await mockCatalog(page, {
    deezerSearch: () => ({ fail: true }),
    search: (_params, call) => (call === 1 ? { fail: true } : undefined),
  });
  await page.goto('/');

  await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');

  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByRole('button', { name: /Ada Vale/ })).toBeVisible();
  await expect(page.getByText("Couldn't reach the catalog")).toBeHidden();
});

test('a rate-limited album search says Apple is limiting searches, and Retry runs it again', async ({
  page,
}) => {
  await mockCatalog(page, {
    search: (_params, call) => (call === 1 ? { status: 429 } : undefined),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Albums' }).click();

  await page.getByRole('searchbox', { name: 'Search albums' }).fill('ada');

  await expect(page.getByText('Apple is limiting searches right now')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByRole('button', { name: /Ada Vale No\. 1/ })).toBeVisible();
  await expect(page.getByText('Apple is limiting searches right now')).toBeHidden();
});

test('an artist search is answered by Deezer and stores a Deezer seed', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/');

  await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');

  const result = page.getByRole('button', { name: /Ada Vale/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('18k fans');
  await result.click();

  await expect(page.getByRole('button', { name: 'Remove Ada Vale' })).toBeVisible();
  expect(await storedSeeds(page)).toMatchObject([
    { id: 'dz:artist:4101', kind: 'artist', name: 'Ada Vale', deezerArtistId: 4101 },
  ]);
});

test('when Deezer errors the artist search falls back to iTunes and still shows results', async ({
  page,
}) => {
  await mockCatalog(page, { deezerSearch: () => ({ fail: true }) });
  await page.goto('/');

  await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');

  const result = page.getByRole('button', { name: /Ada Vale/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Electronic');
  await result.click();

  expect(await storedSeeds(page)).toMatchObject([
    { kind: 'artist', name: 'Ada Vale', itunesArtistId: 9101 },
  ]);
});

test('a genre chip toggles its seed and styles itself with the accent', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/');

  const pop = page.getByRole('button', { name: 'Pop', exact: true });
  await expect(pop).toHaveAttribute('aria-pressed', 'false');

  await pop.click();
  await expect(pop).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => pop.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(ACCENT_SUBTLE);
  // The border/colour transitions end a frame after the background one, so
  // poll them too instead of reading once mid-flight.
  await expect
    .poll(() =>
      pop.evaluate((el) => {
        const style = getComputedStyle(el);
        return { border: style.borderTopColor, color: style.color };
      }),
    )
    .toEqual({ border: ACCENT, color: ACCENT });
  expect(await storedSeeds(page)).toMatchObject([{ id: 'genre:pop', kind: 'genre', chips: ['pop'] }]);

  await pop.click();
  await expect(pop).toHaveAttribute('aria-pressed', 'false');
  expect(await storedSeeds(page)).toEqual([]);
});

test('the card-type control switches Artists, Albums and Songs and persists', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Albums' }).click();
  await expect(page.getByRole('button', { name: 'Albums' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Artists' })).toHaveAttribute('aria-pressed', 'false');
  expect(await storedCardType(page)).toBe('album');

  await page.getByRole('button', { name: 'Songs' }).click();
  await expect(page.getByRole('button', { name: 'Songs' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Albums' })).toHaveAttribute('aria-pressed', 'false');
  expect(await storedCardType(page)).toBe('song');
});

test('Start discovering waits for a seed, opens Discovery and the setup survives a reload', async ({
  page,
}) => {
  await mockCatalog(page);
  await page.goto('/');

  const start = page.getByRole('button', { name: 'Start discovering' });
  await expect(start).toBeDisabled();

  await page.getByRole('button', { name: 'Albums' }).click();
  await page.getByRole('button', { name: 'Pop', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search albums' }).fill('north');
  await page.getByRole('button', { name: /North Static No\. 1/ }).click();

  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your deck is getting ready' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Your deck is getting ready' })).toBeVisible();
  await page.getByRole('button', { name: 'Change seeds' }).click();

  await expect(page.getByRole('button', { name: 'Albums' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Remove North Static No. 1' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search albums' })).toBeVisible();
});

test('every setup control is at least 44 px tall and reachable by keyboard with a focus ring', async ({
  page,
}) => {
  await mockCatalog(page);
  await page.goto('/');

  const ring = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (active === null) return null;
      const style = getComputedStyle(active);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });

  // Tab from the untouched page: header settings, then the seed search.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search artists' })).toBeFocused();
  expect((await ring())?.style).toBe('solid');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Artists' })).toBeFocused();
  const buttonRing = await ring();
  expect(buttonRing?.style).toBe('solid');
  expect(Number.parseFloat(buttonRing?.width ?? '0')).toBeGreaterThanOrEqual(2);

  await page.getByRole('searchbox', { name: 'Search artists' }).fill('ada');
  await page.getByRole('button', { name: /Ada Vale/ }).click();

  const controls = [
    page.getByRole('searchbox', { name: 'Search artists' }),
    page.getByRole('button', { name: 'Artists' }),
    page.getByRole('button', { name: 'Pop', exact: true }),
    page.getByRole('button', { name: 'Remove Ada Vale' }),
    page.getByRole('button', { name: 'Start discovering' }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
