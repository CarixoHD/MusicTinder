import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("listener seeds artists, an album and a genre; it survives a reload", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    const entity = u.searchParams.get("entity");
    const results =
      entity === "album"
        ? [{ wrapperType: "collection", collectionType: "Album", collectionId: ++id, collectionName: `${term} LP`, artistName: "Some Artist", artistId: ++id, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Rock", releaseDate: "2001-01-01T00:00:00Z" }]
        : [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: ++id, primaryGenreName: "Electronic" }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  // Artist search is Deezer-first (ADR-005). Related lists are empty, so the
  // deck ends quietly and its Change seeds control returns to Setup.
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: [] };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start discovering" });
  await expect(start).toBeDisabled();

  const a1 = `Alpha${stamp}`;
  const a2 = `Beta${stamp}`;
  const al = `Gamma${stamp}`;

  await page.getByRole("searchbox", { name: "Search artists" }).fill(a1);
  await page.getByRole("button", { name: new RegExp(`${a1} Band`) }).click();
  await page.getByRole("searchbox", { name: "Search artists" }).fill(a2);
  await page.getByRole("button", { name: new RegExp(`${a2} Band`) }).click();

  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search albums" }).fill(al);
  await page.getByRole("button", { name: new RegExp(`${al} LP`) }).click();
  await page.getByRole("button", { name: "Artists", exact: true }).click();

  const jazz = page.getByRole("button", { name: "Jazz" });
  await jazz.click();
  await expect(jazz).toHaveAttribute("aria-pressed", "true");

  for (const name of [`${a1} Band`, `${a2} Band`, `${al} LP`]) {
    await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
  }
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole("button", { name: "Change seeds" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Change seeds" }).click();
  for (const name of [`${a1} Band`, `${a2} Band`, `${al} LP`]) {
    await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Jazz" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Artists", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Start discovering" })).toBeEnabled();
});
