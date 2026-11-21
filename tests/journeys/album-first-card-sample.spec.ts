import { test, expect } from "./journey";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
test("first album card on a fresh Albums deck can play a sample", async ({ page }) => {
  const stamp = Date.now(); let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity"); const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Rock" }];
    else if (entity === "album") { const aid = Number(u.searchParams.get("id")); results = Array.from({ length: 5 }, () => { const c = ++id; return { wrapperType: "collection", collectionType: "Album", collectionId: c, collectionName: `Album${c}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Rock", releaseDate: "2015-01-01T00:00:00Z" }; }); }
    else if (entity === "song") { const cid = Number(u.searchParams.get("id")); results = Array.from({ length: 3 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song${t}`, collectionId: cid, collectionName: `Album${cid}`, artistName: "X", artistId: 1, previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, primaryGenreName: "Rock", releaseDate: "2015-01-01T00:00:00Z" }; }); }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url()); const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });
  await page.goto("/");
  for (const n of [`Stratus${stamp}`, `Cumulus${stamp}`]) {
    await page.getByRole("searchbox", { name: "Search artists" }).fill(n);
    await page.getByRole("button", { name: new RegExp(`${n} Band`) }).click();
  }
  await page.getByRole("button", { name: "Albums", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();
  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Album\d+$/);
  await expect(card.getByRole("button", { name: "Play sample" })).toBeVisible({ timeout: 10000 });
});
