import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("after Reset all my data, picking the same artist again deals a fresh deck with no old likes", async ({ page }) => {
  const stamp = Date.now() % 100000;
  const seedName = `Nova${stamp}`;
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
      results = Array.from({ length: 3 }, (_, i) => {
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
      ? { data: [{ id: stamp, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, (_, i) => ({ id: stamp * 10 + i, name: `Kin${stamp * 10 + i}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  const seedAndStart = async () => {
    await page.getByRole("searchbox", { name: "Search artists" }).fill(seedName);
    await page.getByRole("button", { name: new RegExp(`${seedName} Band`) }).click();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("button", { name: "Start discovering" }).click();
  };

  await page.goto("/");
  await seedAndStart();
  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Song \d+$/);
  const first = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(first);
  const second = (await title.textContent())!;
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(title).not.toHaveText(second);

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Reset all my data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();

  await seedAndStart();
  await expect(title).toHaveText(/^Song \d+$/);
  await expect(page.getByText("Nothing to recommend from these seeds yet")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toBeVisible();
});
