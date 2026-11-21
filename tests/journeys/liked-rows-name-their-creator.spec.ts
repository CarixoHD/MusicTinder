import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("liked album and song rows name their creator, and an artist row shows its genre without repeating its name", async ({ page }) => {
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
    } else if (entity === "album") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 5 }, () => {
        const c = ++id;
        return { wrapperType: "collection", collectionType: "Album", collectionId: c, collectionName: `Record${c}`, artistName: `Maker${c}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2015-01-01T00:00:00Z" };
      });
    } else if (entity === "song") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 5 }, () => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Tune${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Singer${t}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, primaryGenreName: "Jazz", releaseDate: "2012-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 8 }, () => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 50000 }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Row${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Row${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Record\d+$/, { timeout: 20_000 });
  const album = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(album);

  await page.getByRole("button", { name: /^Seeds: .*Edit$/ }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  await expect(title).toHaveText(/^Tune\d+$/, { timeout: 20_000 });
  const song = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(song);

  await page.getByRole("button", { name: /^Seeds: .*Edit$/ }).click();
  await page.getByRole("button", { name: "Artists", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  await expect(title).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  const artist = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(artist);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  const albumRow = page.getByRole("link", { name: new RegExp(`^${album}, Album · Maker\\d+, 2015, open in Spotify$`) });
  await expect(albumRow).toBeVisible();
  await expect(page.getByText(/^Album · Maker\d+$/)).toBeVisible();
  const songRow = page.getByRole("link", { name: new RegExp(`^${song}, Song · Singer\\d+, 2012, open in Spotify$`) });
  await expect(songRow).toBeVisible();
  await expect(page.getByText(/^Song · Singer\d+$/)).toBeVisible();
  const artistRow = page.getByRole("link", { name: new RegExp(`^${artist}, Artist · Jazz, open in Spotify$`) });
  await expect(artistRow).toBeVisible();
  await expect(page.getByText(`Artist · Jazz`, { exact: true })).toBeVisible();
});
