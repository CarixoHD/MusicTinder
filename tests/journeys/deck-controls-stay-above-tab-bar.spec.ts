import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("like and skip stay above the tab bar at a short desktop window and a small phone, even with a long title", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  const longName = `The Extraordinarily Long Named Orchestra Of ${stamp}`;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("The Extraordinarily") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (entity === "song") {
      const t = ++id;
      results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: `Sample ${t}`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, (_, i) => ({ id: ++id, name: i === 0 ? longName : `Kin${id}`, nb_fan: 40000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  // The reported layout problem showed up on a fresh load at a short desktop window.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Layout${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Layout${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/\S/, { timeout: 20_000 });
  await expect(card.getByRole("button", { name: /^Play sample/ })).toBeVisible({ timeout: 20_000 });

  const geometry = async () => {
    const like = (await page.getByRole("button", { name: "Like", exact: true }).boundingBox())!;
    const skip = (await page.getByRole("button", { name: "Skip", exact: true }).boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
    return { like, skip, nav, viewH: await page.evaluate(() => window.innerHeight), pageScroll: await page.evaluate(() => window.scrollY) };
  };

  for (const size of [{ width: 1280, height: 600 }, { width: 360, height: 640 }]) {
    if (await page.evaluate(() => window.innerWidth) !== size.width) await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 10_000 }).toBe(size.height);
    const g = await geometry();
    expect(g.like.y, `at ${size.width}x${size.height} Like top ${g.like.y}`).toBeGreaterThanOrEqual(0);
    expect(g.like.y + g.like.height, `at ${size.width}x${size.height}: Like bottom ${Math.round(g.like.y + g.like.height)} vs tab bar top ${Math.round(g.nav.y)}`).toBeLessThanOrEqual(g.nav.y + 1);
    expect(g.skip.y + g.skip.height, `at ${size.width}x${size.height}: Skip bottom ${Math.round(g.skip.y + g.skip.height)} vs tab bar top ${Math.round(g.nav.y)}`).toBeLessThanOrEqual(g.nav.y + 1);
    expect(g.nav.y + g.nav.height, `at ${size.width}x${size.height}: tab bar inside the window`).toBeLessThanOrEqual(size.height + 1);
    expect(g.pageScroll, `at ${size.width}x${size.height}: page was scrolled`).toBe(0);
  }
});
