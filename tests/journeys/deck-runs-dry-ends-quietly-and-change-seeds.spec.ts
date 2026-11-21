import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("when a small catalog runs dry the deck ends quietly without repeats, and Change seeds returns to Setup", async ({ page }) => {
  const stamp = Date.now() % 100000;
  const seedName = `Dry${stamp}`;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = term.startsWith("Kin")
        ? [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: Number(term.slice(3)), primaryGenreName: "Rock" }]
        : [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: stamp, primaryGenreName: "Rock" }];
    } else if (entity === "song") {
      const aid = Number(u.searchParams.get("id"));
      results = Array.from({ length: 2 }, (_, i) => {
        const t = aid * 10 + i;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song ${t}`, collectionId: t + 1, collectionName: `Coll ${t}`, artistName: `Maker ${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Rock", releaseDate: "2012-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: stamp, name: u.searchParams.get("q") }] }
      : { data: Array.from({ length: 3 }, (_, i) => ({ id: stamp * 10 + i, name: `Kin${stamp * 10 + i}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(seedName);
  await page.getByRole("button", { name: new RegExp(`${seedName} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Song \d+$/);
  const end = page.getByRole("heading", { name: "That's everything in this direction" });
  const current = async () => ((await title.count()) === 0 ? null : await title.innerText());
  const seen = new Set<string>();
  for (let i = 0; i < 20 && !(await end.isVisible()); i++) {
    const t = await current();
    if (t) {
      expect(seen.has(t)).toBe(false);
      seen.add(t);
      await page.getByRole("button", { name: "Like", exact: true }).click();
    }
    await expect.poll(async () => (await end.isVisible()) || (await current()) !== t, { timeout: 20_000 }).toBe(true);
  }
  await expect(end).toBeVisible();
  expect(seen.size).toBeGreaterThan(2);
  await expect(page.getByText("Couldn't reach the catalog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fresh deck" })).toBeVisible();

  await page.getByRole("button", { name: "Change seeds" }).click();
  await expect(page.getByRole("button", { name: `Remove ${seedName} Band` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start discovering" })).toBeEnabled();
});
