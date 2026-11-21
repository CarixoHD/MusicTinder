import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("artist card artwork is large even when the card's text is short", async ({ page }) => {
  let id = Date.now();
  let k = 0;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: ++id, primaryGenreName: "Pop" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: u.searchParams.get("q") }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `K${++k}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill("Ab");
  await page.getByRole("button", { name: /^Ab/ }).first().click();
  await expect(page.getByRole("button", { name: "Artists", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^K\d+$/);
  const main = (await page.locator("main").boundingBox())!;
  const art = (await card.locator(":scope > *").first().boundingBox())!;
  expect(art.width, `artwork is ${Math.round(art.width)}px wide in a ${Math.round(main.width)}px column`).toBeGreaterThanOrEqual(main.width * 0.7);
});
