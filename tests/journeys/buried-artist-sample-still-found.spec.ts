import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("an artist whose own song is buried below other artists in the results still gets its sample", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  const artist = `Kin${stamp}7`;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Folk" }];
    } else if (entity === "song") {
      const t = ++id;
      if (term === artist) {
        // Six closer-looking songs by other artists come first; this artist's own is at position 7.
        results = [
          ...Array.from({ length: 6 }, () => ({ wrapperType: "track", kind: "song", trackId: ++id, trackName: `Wrong ${++id}`, artistId: ++id, artistName: "Somebody Else", collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", previewUrl: `https://audio-ssl.itunes.apple.com/p${++id}.m4a`, releaseDate: "2010-01-01T00:00:00Z" })),
          { wrapperType: "track", kind: "song", trackId: ++id, trackName: `Buried Sample ${stamp}`, artistId: ++id, artistName: artist, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", previewUrl: `https://audio-ssl.itunes.apple.com/p${++id}.m4a`, releaseDate: "2010-01-01T00:00:00Z" },
        ];
      } else {
        results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: `Other ${t}`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }];
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: [{ id: artist, name: artist, nb_fan: 40000 }, ...Array.from({ length: 5 }, () => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 40000 }; })] };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Buried${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Buried${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(new RegExp(`^${artist}$`), { timeout: 20_000 });
  await expect(card.getByRole("button", { name: `Play sample: Buried Sample ${stamp}` })).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("No sample")).toHaveCount(0);
  await expect(card.getByText(new RegExp(`Sample: Buried Sample ${stamp}`))).toBeVisible();
});
