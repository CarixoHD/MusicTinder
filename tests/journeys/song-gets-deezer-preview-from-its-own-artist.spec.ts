import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 3, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("a song with no iTunes preview still gets its own Deezer sample, never another artist's track", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin\d+$/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (entity === "song") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 2 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `NoPrev${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2013-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/cdns-preview\.dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    if (u.pathname.includes("/search/track")) {
      const q = u.searchParams.get("q") ?? "";
      const creator = (q.match(/^(Maker\d+)/) ?? [q])[0];
      const trackId = ++id;
      const data = { data: [
        // A closer catalog hit by someone else must never be used as this card's sample.
        { id: ++id, title: `Wrong Song ${stamp}`, preview: `https://cdns-preview.dzcdn.net/stream/wrong-${trackId}.mp3`, artist: { name: "Impostor" } },
        { id: ++id, title: `Right Song ${stamp} ${trackId}`, preview: `https://cdns-preview.dzcdn.net/stream/right-${trackId}.mp3`, artist: { name: creator } },
      ] };
      return route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
    }
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, () => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 50000 }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Deezer${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Deezer${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^NoPrev\d+$/, { timeout: 20_000 });
  const play = card.getByRole("button", { name: new RegExp(`^Play sample: Right Song ${stamp}`) });
  await expect(play).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole("button", { name: new RegExp(`Wrong Song ${stamp}`) })).toHaveCount(0);
  await expect(card.getByText("No sample")).toHaveCount(0);
  await play.click();
  await expect(card.getByRole("button", { name: new RegExp(`^Pause sample: Right Song ${stamp}`) })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Like", exact: true }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  const row = page.getByRole("link", { name: new RegExp(`^NoPrev\\d+, Song · Maker\\d+, 2013, open in Spotify$`) });
  await expect(row.first()).toBeVisible();
});
