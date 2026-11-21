import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("peeking at Liked and coming back keeps the card the listener was judging, and the deck keeps dealing", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    let results: object[];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Electronic" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Song${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Electronic", releaseDate: "2012-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `Peek${stamp} Band` }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Peek${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Peek${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  for (let i = 0; i < 4; i++) {
    await expect(title).toHaveText(/^Song\d+$/);
    const current = (await title.textContent())!;
    await page.getByRole("button", { name: "Liked", exact: true }).click();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
    await page.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(title).toHaveText(current);
  }
  await expect(page.getByText("That's everything in this direction")).toHaveCount(0);
});
