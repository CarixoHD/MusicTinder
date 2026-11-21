import { test, expect } from "./journey";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
test("switching an Artists deck to Songs mid-session deals songs", async ({ page }) => {
  const stamp = Date.now(); let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url()); const entity = u.searchParams.get("entity"); const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Electronic" }];
    else if (entity === "song") { const aid = Number(u.searchParams.get("id")) || ++id; results = Array.from({ length: 3 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Tune${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Electronic", releaseDate: "2012-01-01T00:00:00Z" }; }); }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url()); const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 5000 }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Halo${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Halo${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  const liked = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(liked);
  await page.getByRole("button", { name: /^Seeds: .*Edit$/ }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  await expect(title).toHaveText(/^Tune\d+$/, { timeout: 20_000 });
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
});
