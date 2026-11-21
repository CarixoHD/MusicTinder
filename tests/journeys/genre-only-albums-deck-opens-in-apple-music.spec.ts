import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("with only a genre chip as seed, an Albums deck deals Folk albums; likes open in Apple Music and dark theme survives reload", async ({ page }) => {
  let id = Date.now() % 1000000 * 1000;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: ++id, primaryGenreName: "Folk" }];
    } else if (entity === "album") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 3 }, () => { const c = ++id; return { wrapperType: "collection", collectionType: "Album", collectionId: c, collectionName: `Record${c}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", releaseDate: "2015-01-01T00:00:00Z" }; });
    } else if (entity === "song") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 3 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song${t}`, collectionId: ++id, collectionName: `Coll${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", releaseDate: "2012-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: u.searchParams.get("q") }] }
      : { data: Array.from({ length: 10 }, () => { const d = ++id; return { id: d, name: `Kin${d}` }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const start = page.getByRole("button", { name: "Start discovering" });
  await expect(start).toBeDisabled();
  const folk = page.getByRole("button", { name: "Folk", exact: true });
  await folk.click();
  await expect(folk).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await expect(start).toBeEnabled();
  await start.click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Record\d+$/, { timeout: 20_000 });
  await expect(card.getByText("Folk", { exact: true })).toBeVisible();
  await expect(card.getByText(/Because you like/)).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Apple Music" }).click();
  await expect(dialog.getByRole("button", { name: "Apple Music" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Dark" }).click();
  await expect(dialog.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).toBeHidden();

  const liked: string[] = [];
  for (let i = 0; i < 2; i++) {
    await expect(title).toHaveText(/^Record\d+$/, { timeout: 20_000 });
    const t = (await title.textContent())!;
    liked.push(t);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }

  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  for (const t of liked) {
    const row = page.getByRole("link", { name: new RegExp(t) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", new RegExp(`^https://music\\.apple\\.com/.*${t}`));
  }
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Apple Music" })).toHaveAttribute("aria-pressed", "true");
});
