import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("an artist with no preview shows 'No sample', is looked up only once, and can still be liked", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 1000;
  const songLookups: Record<string, number> = {};
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Folk" }];
    } else if (entity === "song") {
      songLookups[term] = (songLookups[term] ?? 0) + 1;
      results = [{ wrapperType: "track", kind: "song", trackId: ++id, trackName: `${term} s`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", releaseDate: "2010-01-01T00:00:00Z" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, () => { const d = ++id; return { id: d, name: `Kin${d}` }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Quiet${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Quiet${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Kin\d+$/);
  const t = (await title.textContent())!;
  await expect(card.getByText("No sample")).toBeVisible();
  await expect(card.getByRole("button", { name: "Play sample" })).toHaveCount(0);
  // a genuine "no preview" answer is not retried over and over
  await expect.poll(() => songLookups[t] ?? 0).toBe(1);
  await page.waitForTimeout(4000);
  expect(songLookups[t]).toBe(1);
  await expect(card.getByText("No sample")).toBeVisible();

  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(t);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(t) })).toHaveAttribute("href", new RegExp(`^https://open\\.spotify\\.com/.*${t}`));
});
