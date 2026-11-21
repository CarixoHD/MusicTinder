import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("song cards keep large, same-size artwork whether the title is very long or very short, with no sideways scroll", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    let results: object[];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: ++id, primaryGenreName: "Rock" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, (_, i) => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: i % 2 ? `S${t}` : `An Extraordinarily Long Song Title That Goes On And On Forever Number ${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Rock", releaseDate: "2012-01-01T00:00:00Z" };
      });
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
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Wide${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Wide${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  const artWidth = async () => Math.round((await card.locator(":scope > *").first().boundingBox())!.width);
  const widths: number[] = [];
  let sawLong = false, sawShort = false;
  for (let i = 0; i < 4; i++) {
    await expect(title).toHaveText(/\S/);
    const t = (await title.textContent())!;
    if (t.startsWith("An Extraordinarily")) sawLong = true; else sawShort = true;
    const main = (await page.locator("main").boundingBox())!;
    await expect.poll(artWidth).toBeGreaterThanOrEqual(Math.floor(main.width * 0.7));
    const art = (await card.locator(":scope > *").first().boundingBox())!;
    widths.push(Math.round(art.width));
    expect(Math.abs(art.width - art.height)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  expect(sawLong && sawShort).toBe(true);
  expect(Math.max(...widths) - Math.min(...widths), `artwork widths ${widths.join(", ")}`).toBeLessThanOrEqual(12);
});
