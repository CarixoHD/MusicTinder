import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAABAAAAAQCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("at a quiet deck end, Fresh deck deals the new candidates and keeps the likes", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now() % 100000;
  const seedName = `Fresh${stamp}`;
  const WAV = wav();
  let id = stamp * 100;
  const batchA = [`Kin${stamp}A0`, `Kin${stamp}A1`];
  const batchB = [`Kin${stamp}B0`, `Kin${stamp}B1`];
  let freshClicked = false;
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
      const aid = Number(u.searchParams.get("id")) || ++id;
      const t = ++id;
      results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: `Song ${t}`, collectionId: ++id, collectionName: "C", artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2012-01-01T00:00:00Z" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const names = freshClicked ? batchB : batchA;
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: names.map((n) => ({ id: n, name: n, nb_fan: 2000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(seedName);
  await page.getByRole("button", { name: new RegExp(`${seedName} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  const end = page.getByRole("heading", { name: "That’s everything in this direction" });
  await expect(title).toHaveText(/^Song \d+$/, { timeout: 20_000 });
  const liked: string[] = [];
  for (let i = 0; i < 10 && !(await end.isVisible()); i++) {
    const t = await title.textContent().catch(() => null);
    if (!t) { await expect(end).toBeVisible({ timeout: 20_000 }); break; }
    liked.push(t);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect.poll(async () => (await end.isVisible()) || ((await title.count()) > 0 && (await title.textContent()) !== t), { timeout: 20_000 }).toBe(true);
  }
  await expect(end).toBeVisible({ timeout: 20_000 });

  freshClicked = true;
  await page.getByRole("button", { name: "Fresh deck" }).click();
  await expect(title).toHaveText(/^Song \d+$/, { timeout: 20_000 });
  const fresh = (await title.textContent())!;
  expect(liked).not.toContain(fresh);
  await expect(card.getByText(new RegExp(`Because you like`))).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  for (const t of liked) await expect(page.getByRole("link", { name: new RegExp(`^${t}, Song · Maker`) })).toBeVisible();
});
