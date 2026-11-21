import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("removing the last seed disables Start but the artist already liked is still in the Liked list after reload", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    const results = entity === "musicArtist"
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 90000 }] }
      : { data: Array.from({ length: 6 }, () => ({ id: ++id, name: `Kin${id}`, nb_fan: 4000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  const seed = `Solo${stamp} Band`;
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Solo${stamp}`);
  await page.getByRole("button", { name: new RegExp(`^Solo${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Kin\d+$/);
  const liked = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(liked);

  // Back to Setup from the deck and take the only seed away.
  await page.getByRole("button", { name: /^Seeds: .*Edit$/ }).click();
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();
  await page.getByRole("button", { name: `Remove ${seed}` }).click();
  await expect(page.getByRole("button", { name: `Remove ${seed}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start discovering" })).toBeDisabled();

  // The find is not a seed, so it stays.
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  const row = page.getByRole("link", { name: new RegExp(`^${liked}, Artist`) });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("href", new RegExp(`^https://open\\.spotify\\.com/.*${liked}`));

  await page.reload();
  await expect(page.getByRole("button", { name: "Start discovering" })).toBeDisabled();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${liked}, Artist`) })).toBeVisible();
});
