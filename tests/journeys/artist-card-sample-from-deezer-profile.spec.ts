import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 3, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("an artist card takes its sample from Deezer when the artist has a Deezer profile, without an iTunes song lookup", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  let itunesSongLookups = 0;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/cdns-preview\.dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    if (entity === "song") itunesSongLookups += 1;
    const results = entity === "musicArtist"
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin\d+$/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Electronic" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const match = u.pathname.match(/\/artist\/(\d+)\/top/);
    let data: object;
    if (u.pathname.includes("/search")) {
      data = { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 90000 }] };
    } else if (u.pathname.includes("/related")) {
      data = { data: Array.from({ length: 6 }, (_, i) => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 5000 + i }; }) };
    } else if (match) {
      const trackId = ++id;
      data = { data: [{ id: trackId, title: `Deezer Top ${trackId}`, preview: `https://cdns-preview.dzcdn.net/stream/top-${trackId}.mp3`, artist: { name: `artist-${match[1]}` } }] };
    } else {
      data = { data: [] };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`DeezerTop${stamp}`);
  await page.getByRole("button", { name: new RegExp(`DeezerTop${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  const play = card.getByRole("button", { name: /^Play sample: Deezer Top \d+$/ });
  await expect(play).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/Sample: Deezer Top \d+/)).toBeVisible();
  expect(itunesSongLookups, "iTunes song lookups for a card whose artist has a Deezer profile").toBe(0);
  await play.click();
  await expect(card.getByRole("button", { name: /^Pause sample: Deezer Top \d+$/ })).toBeVisible({ timeout: 20_000 });
});
