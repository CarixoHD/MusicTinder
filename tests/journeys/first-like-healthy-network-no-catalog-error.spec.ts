import { test, expect } from "./journey";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const h = (s: string) => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 9973; return x + 100; };
test("a first like on a healthy network never shows Couldn't reach the catalog", async ({ page }) => {
  const stamp = Date.now() % 100000;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    const results = u.searchParams.get("entity") === "musicArtist" ? [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: h(term) * 3, primaryGenreName: "Electronic" }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback"); const q = u.searchParams.get("q") ?? "";
    let data: object;
    if (u.pathname.includes("/search")) { const b = h(q) * 10; data = { data: [{ id: b + 2, name: q, nb_fan: 450000 }] }; }
    else { const aid = Number(u.pathname.match(/artist\/(\d+)/)?.[1]); data = { data: Array.from({ length: 6 }, (_, i) => ({ id: aid * 10 + i + 4, name: `Syn${aid * 10 + i + 4}`, nb_fan: 1000 * (i + 1) })) }; }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });
  await page.goto("/");
  for (const n of [`Brut${stamp}`, `Kavin${stamp}`]) {
    await page.getByRole("searchbox", { name: "Search artists" }).fill(n);
    await page.getByRole("button", { name: new RegExp(`^${n} 450k fans`) }).click();
  }
  await page.getByRole("button", { name: /Start discovering/ }).click();
  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Syn\d+$/, { timeout: 20_000 });
  for (let i = 0; i < 4; i++) {
    const t = (await title.textContent())!;
    await page.getByRole("button", { name: i === 0 ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(t, { timeout: 20_000 });
    await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
  }
});
