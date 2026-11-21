import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 8, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  for (let i = 44; i < 44 + n; i++) b[i] = 128 + Math.round(40 * Math.sin(i / 5));
  return b;
}

test("on an Artists deck the first tap plays a sample, the next card auto-plays, and Sound off in Settings stops it", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  const WAV = wav();
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Electronic" }];
    } else if (u.pathname.includes("search") && entity === "song") {
      results = Array.from({ length: 3 }, () => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: term, artistId: ++id, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, primaryGenreName: "Electronic", releaseDate: "2012-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  // registered after the catalog route so it wins for audio-ssl.itunes.apple.com
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}`, picture_big: "https://e-cdns-images.dzcdn.net/x.jpg" })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Aurora${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Aurora${stamp} Band`) }).click();
  await expect(page.getByRole("button", { name: "Artists", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Kin\d+$/);
  await expect(card.getByText(/Because you like/)).toBeVisible();

  await card.getByRole("button", { name: "Play sample" }).click();
  await expect(card.getByRole("button", { name: "Pause sample" })).toBeVisible();

  const first = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(first);
  // next card plays without another tap
  await expect(card.getByRole("button", { name: "Pause sample" })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("switch", { name: "Sound is on" }).click();
  await expect(dialog.getByRole("switch", { name: "Sound is off" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(card.getByRole("button", { name: "Play sample" })).toBeVisible();
});
