import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("when the catalog drops mid-session, dealt cards still swipe and the app offers Retry", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  let down = false;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    if (down) return route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<html>gateway hiccup</html>" });
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    let results: object[];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Rock" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 3 }, () => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Track ${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker ${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Rock", releaseDate: "2005-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = down
      ? { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }
      : u.pathname.includes("/search")
        ? { data: [{ id: ++id, name: u.searchParams.get("q") }] }
        : { data: Array.from({ length: 2 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Orbit${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Orbit${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Track \d+$/);

  down = true;
  const retry = page.getByRole("button", { name: "Retry" });
  const seen = new Set<string>();
  // the dealt card still swipes; the deck keeps going until it runs dry, never repeating
  for (let i = 0; i < 30 && !(await retry.isVisible()); i++) {
    const t = (await title.textContent().catch(() => null)) ?? "";
    expect(seen.has(t)).toBe(false);
    seen.add(t);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect.poll(async () => (await retry.isVisible()) || ((await title.textContent().catch(() => t)) !== t)).toBe(true);
  }
  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible();
  await expect(page.getByText(/That's everything/)).toHaveCount(0);

  down = false;
  await retry.click();
  await expect(title).toHaveText(/^Track \d+$/);
  await expect(page.getByText("Couldn't reach the catalog")).toBeHidden();
});
