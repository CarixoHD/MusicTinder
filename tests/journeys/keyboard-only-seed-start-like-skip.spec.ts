import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("keyboard only: add a seed, start, like with → and skip with ←; the like is kept after reload", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    let results: object[];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Key${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2011-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `Keys${stamp} Band` }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search artists" });
  await box.focus();
  await page.keyboard.type(`Keys${stamp}`);
  const hit = page.getByRole("button", { name: new RegExp(`Keys${stamp} Band`) });
  await expect(hit).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(hit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Remove Keys${stamp} Band` })).toBeVisible();

  await page.getByRole("button", { name: "Songs", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Songs", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start discovering" }).focus();
  await page.keyboard.press("Enter");

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Key\d+$/);
  const liked = (await title.textContent())!;
  await page.keyboard.press("ArrowRight");
  await expect(title).not.toHaveText(liked);
  const skipped = (await title.textContent())!;
  await page.keyboard.press("ArrowLeft");
  await expect(title).not.toHaveText(skipped);

  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(liked) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(skipped) })).toHaveCount(0);
});
