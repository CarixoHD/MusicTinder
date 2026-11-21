import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("two artists, an album and two genres on an Albums deck; likes by button and → key open in Spotify and survive reload", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (u.pathname.includes("search") && entity === "album") {
      results = [{ wrapperType: "collection", collectionType: "Album", collectionId: ++id, collectionName: `${term} LP`, artistName: "Some Artist", artistId: ++id, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2001-01-01T00:00:00Z" }];
    } else if (entity === "album") {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 4 }, () => { const c = ++id; return { wrapperType: "collection", collectionType: "Album", collectionId: c, collectionName: `Record${c}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2015-01-01T00:00:00Z" }; });
    } else if (entity === "song") {
      const cid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 2 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Track${t}`, collectionId: cid, collectionName: `Record${cid}`, artistName: "X", artistId: 1, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2015-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: u.searchParams.get("q") }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const artistBox = page.getByRole("searchbox", { name: "Search artists" });
  for (const n of [`Ella${stamp}`, `Monk${stamp}`]) {
    await artistBox.fill(n);
    await page.getByRole("button", { name: new RegExp(`${n} Band`) }).click();
  }
  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Search scope" }).getByRole("radio", { name: "Albums" }).check();
  await page.getByRole("searchbox", { name: "Search albums" }).fill(`Blue${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Blue${stamp} LP`) }).click();
  await page.getByRole("button", { name: "Jazz" }).click();
  await page.getByRole("button", { name: "Blues" }).click();
  for (const n of [`Ella${stamp} Band`, `Monk${stamp} Band`, `Blue${stamp} LP`]) {
    await expect(page.getByRole("button", { name: `Remove ${n}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Record\d+$/);
  await expect(card.getByText(/Because you like/)).toBeVisible();
  await expect(card.getByText("2015")).toBeVisible();

  const liked: string[] = [];
  const a = (await title.textContent())!;
  liked.push(a);
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(a);
  const b = (await title.textContent())!;
  liked.push(b);
  await page.keyboard.press("ArrowRight");
  await expect(title).not.toHaveText(b);

  await page.reload();
  // the deck comes straight back (seeds kept, no setup, no sign-up) with an unseen album
  await expect(title).toHaveText(/^Record\d+$/);
  expect(liked).not.toContain(await title.textContent());

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  for (const t of liked) {
    const row = page.getByRole("link", { name: new RegExp(t) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", /^https:\/\/open\.spotify\.com\//);
  }
});
