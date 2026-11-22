import { test, expect } from './journey';

// #35: with zero seeds there is no deck to open. The Discover tab and Liked's
// 'Go to Discover' both land on Setup's seed pickers, never on a Discovery
// empty state that would just bounce the listener again.

for (const size of [
  { width: 1280, height: 800, label: 'desktop' },
  { width: 390, height: 844, label: 'phone' },
]) {
  test(`first-run Discover returns to Setup at ${size.label} width`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');

    const search = page.getByRole('searchbox', { name: 'Search artists' });
    await expect(search).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start discovering' })).toBeDisabled();

    const tabbar = page.getByRole('navigation', { name: 'Main' });

    // Liked with nothing saved offers the one way back.
    await tabbar.getByRole('button', { name: 'Liked' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nothing saved yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Discover' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Find something new' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search artists' })).toBeVisible();
    await expect(page.getByText('Nothing to recommend')).toHaveCount(0);
    await expect(tabbar.getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The Discover tab from elsewhere lands in the same place.
    await tabbar.getByRole('button', { name: 'Liked' }).click();
    await tabbar.getByRole('button', { name: 'Discover' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search artists' })).toBeVisible();
    await expect(page.getByText('Nothing to recommend')).toHaveCount(0);
    await expect(tabbar.getByRole('button', { name: 'Discover' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}
