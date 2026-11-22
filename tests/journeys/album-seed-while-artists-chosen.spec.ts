import { expect, type Page } from '@playwright/test';
import { mockCatalog } from '../../e2e/fixtures';
import { test as journey } from './journey';

// #22: an album seed is reachable while 'Deal me' says Artists. The search
// scope is its own decision; switching it must never change what the deck deals.

const storedSeeds = (page: Page): Promise<unknown> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('mt:v1') ?? '{}').state?.seeds ?? []);

for (const size of [
  { width: 1280, height: 800, label: 'desktop' },
  { width: 390, height: 844, label: 'phone' },
]) {
  journey(`an album seed can be added while Artists is the chosen deck at ${size.label} width`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await mockCatalog(page);
    await page.goto('/');

    // What the deck deals stays Artists throughout; the scope is a separate control.
    const dealArtists = page.getByRole('button', { name: 'Artists', exact: true }).first();
    await expect(dealArtists).toHaveAttribute('aria-pressed', 'true');

    const scope = page.getByRole('radiogroup', { name: 'Search scope' });
    await scope.getByRole('radio', { name: 'Albums' }).check();
    await expect(scope.getByRole('radio', { name: 'Albums' })).toBeChecked();

    const input = page.getByRole('searchbox', { name: 'Search albums' });
    await expect(input).toBeVisible();
    await input.fill('ada');
    await page.getByRole('button', { name: /Ada Vale No\. 1/ }).click();

    await expect(page.getByRole('button', { name: 'Remove Ada Vale No. 1' })).toBeVisible();
    expect(await storedSeeds(page)).toMatchObject([
      { kind: 'album', name: 'Ada Vale No. 1', itunesCollectionId: 91011 },
    ]);
    // The album artwork carried by the hit shows on the chosen row.
    const pill = page.getByRole('list', { name: 'Your seeds' }).getByRole('listitem');
    await expect(pill.locator('img')).toHaveAttribute('src', /.+/);

    // Adding an album seed did not touch 'Deal me'.
    await expect(dealArtists).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Albums', exact: true }).last()).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
}
