import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 20, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  for (let i = 44; i < 44 + n; i++) b[i] = 128 + Math.round(40 * Math.sin(i / 5));
  return b;
}

test("with sound on, each artist card on a fresh deck ends up playing its sample even while the catalog budget is busy with a long related list", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now() % 1000000;
  let id = stamp * 1000;
  const WAV = wav();
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (entity === "song") {
      const t = ++id;
      results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: `${term} sample`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: u.searchParams.get("q") }] }
      : { data: Array.from({ length: 25 }, () => { const d = ++id; return { id: d, name: `Kin${d}` }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Bird${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Bird${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Kin\d+$/);
  await card.getByRole("button", { name: "Play sample" }).click();
  await expect(card.getByRole("button", { name: "Pause sample" })).toBeVisible();

  for (let i = 0; i < 4; i++) {
    const t = (await title.textContent())!;
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
    await expect(title).toHaveText(/^Kin\d+$/);
    // no tap: the sample starts by itself, even if the lookup had to wait for the budget
    await expect(card.getByRole("button", { name: "Pause sample" })).toBeVisible({ timeout: 30_000 });
  }
});
