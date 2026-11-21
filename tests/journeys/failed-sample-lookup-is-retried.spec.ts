import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("a card whose sample lookup hits a catalog blip recovers its sample without a reload", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  const failedOnce = new Set<string>();
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    if (entity === "song") {
      if (!failedOnce.has(term)) {
        failedOnce.add(term);
        // A catalog blip: an answer the app cannot use, not a real "no match".
        return route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<html>gateway hiccup</html>" });
      }
      const t = ++id;
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: 1, results: [{ wrapperType: "track", kind: "song", trackId: t, trackName: `Recovered ${stamp} ${t}`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }] }) });
    }
    const results = entity === "musicArtist"
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin\d+$/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, () => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 50000 }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Blip${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Blip${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  await expect(card.getByText("Finding sample")).toBeVisible({ timeout: 20_000 });
  // The catalog answers correctly the second time; the card should recover by itself.
  await expect(card.getByRole("button", { name: new RegExp(`^Play sample: Recovered ${stamp}`) })).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("No sample")).toHaveCount(0);
});
