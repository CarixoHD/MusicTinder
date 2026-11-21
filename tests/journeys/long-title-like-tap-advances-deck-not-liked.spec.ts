import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 4, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

test("on a phone, tapping Like under a long card title likes the card instead of opening Liked", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  // Every card's title is long enough to wrap, whatever order the deck deals.
  const names = Array.from({ length: 6 }, (_, i) => `The Long Named Orchestra Of Late Night Reveries ${stamp} ${i}`);
  // A phone browser viewport with its chrome showing (iPhone SE / 8 in Safari).
  await page.setViewportSize({ width: 375, height: 553 });

  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      const known = term.startsWith("The Long") || /^Kin\d+$/.test(term);
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: known ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (entity === "song") {
      const t = ++id;
      results = [{
        wrapperType: "track", kind: "song", trackId: t, trackName: `Sample ${t}`, artistId: ++id, artistName: term,
        collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg",
        primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2012-01-01T00:00:00Z",
      }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 90000 }] }
      : { data: names.map((name, i) => ({ id: ++id, name, nb_fan: 40000 - i * 1000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`LongTap${stamp}`);
  await page.getByRole("button", { name: new RegExp(`LongTap${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(new RegExp(`^The Long Named Orchestra Of Late Night Reveries ${stamp} \\d$`), { timeout: 20_000 });
  const first = (await title.textContent())!;
  const titleBox = (await title.boundingBox())!;
  expect(titleBox.height, `the title wrapped to ${Math.round(titleBox.height)}px`).toBeGreaterThan(40);

  const like = page.getByRole("button", { name: "Like", exact: true });
  const likeBox = (await like.boundingBox())!;
  const navBox = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  // The whole target is on screen and clear of the tab bar.
  expect(likeBox.height, "Like tap target").toBeGreaterThanOrEqual(44);
  expect(likeBox.y + likeBox.height, "Like bottom vs tab bar top").toBeLessThanOrEqual(navBox.y);
  expect(likeBox.y + likeBox.height, "Like bottom vs viewport").toBeLessThanOrEqual(viewportHeight);

  // A person taps the middle of the visible Like button.
  await page.mouse.click(likeBox.x + likeBox.width / 2, likeBox.y + likeBox.height / 2);

  await expect(title).not.toHaveText(first);
  await expect(page.getByRole("heading", { name: "Discover", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Liked", level: 1 })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(first) })).toBeVisible();
});