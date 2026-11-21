import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 5, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("listener seeds an artist, swipes songs by button, key and drag, plays a sample, and opens likes in their music app", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  const WAV = wav();
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    let results: object[];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Electronic" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, primaryGenreName: "Electronic", releaseDate: "2012-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `Seed${stamp} Band` }] }
      : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}`, picture_big: "https://e-cdns-images.dzcdn.net/x.jpg" })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Seed${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Seed${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Song\d+$/);
  await expect(card.getByText("2012")).toBeVisible();
  await expect(card.getByText("Electronic")).toBeVisible();
  await expect(card.getByText(/Because you like/)).toBeVisible();

  // sound: first tap plays, second pauses
  await card.getByRole("button", { name: "Play sample" }).click();
  await expect(card.getByRole("button", { name: "Pause sample" })).toBeVisible();
  await card.getByRole("button", { name: "Pause sample" }).click();
  await expect(card.getByRole("button", { name: "Play sample" })).toBeVisible();

  // like by button
  const first = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(first);

  // skip by key
  const skipped = (await title.textContent())!;
  await page.keyboard.press("ArrowLeft");
  await expect(title).not.toHaveText(skipped);

  // like by key
  const second = (await title.textContent())!;
  await page.keyboard.press("ArrowRight");
  await expect(title).not.toHaveText(second);

  // like by drag
  const third = (await title.textContent())!;
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(title).not.toHaveText(third);

  await page.getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("heading", { name: "Liked", level: 1 })).toBeVisible();
  for (const t of [first, second, third]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${t}, `) })).toHaveAttribute("href", new RegExp(`^https://open\\.spotify\\.com/search/${t}`));
  }
  await expect(page.getByRole("link", { name: new RegExp(`^${skipped}, `) })).toHaveCount(0);

  // switch music app
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Apple Music" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${first}, `) })).toHaveAttribute("href", /^https:\/\/music\.apple\.com\//);

  // survives reload
  await page.reload();
  await page.getByRole("button", { name: "Liked" }).click();
  for (const t of [first, second, third]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${t}, .*open in Apple Music`) })).toBeVisible();
  }
});
