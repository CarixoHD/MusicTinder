import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("with Reduce Motion on, dragging a card right shows Like without rotating and lands in Liked", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    let results: object[];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Folk" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Calm${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", releaseDate: "2009-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `Still${stamp} Band` }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Still${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Still${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Calm\d+$/);
  const liked = (await title.textContent())!;
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + b.height / 2, { steps: 2 });
  // mid-drag: no rotation anywhere on the card
  const rotated = await card.evaluate((el) => {
    const isRotated = (t: string) => { const m = t.match(/^matrix\(([^)]+)\)$/); if (!m) return false; const [, bb] = m[1].split(",").map(Number); return Math.abs(bb) > 0.001; };
    let n: HTMLElement | null = el as HTMLElement;
    while (n && n.tagName !== "MAIN") { if (isRotated(getComputedStyle(n).transform)) return true; n = n.parentElement; }
    return false;
  });
  expect(rotated).toBe(false);
  await page.mouse.up();
  await expect(title).not.toHaveText(liked);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(liked) })).toBeVisible();
});
