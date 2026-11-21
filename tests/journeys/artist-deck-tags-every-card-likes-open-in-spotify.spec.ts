import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const GENRES = ["Jazz", "Metal", "Pop", "Folk"];

test("in dark mode, every artist card shows a genre tag; liked artists open in Spotify from Liked and survive reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      const kin = /^Rel\d+$/.test(term);
      const g = kin ? GENRES[Number(term.slice(3)) % 4] : "Jazz";
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: kin ? term : `${term} Band`, artistId: ++id, primaryGenreName: g }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: u.searchParams.get("q") }] }
      : { data: Array.from({ length: 8 }, () => { const d = ++id; return { id: d, name: `Rel${d}` }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Mingus${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Mingus${stamp} Band`) }).click();
  await expect(page.getByRole("button", { name: "Artists", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  const liked: string[] = [];
  for (let i = 0; i < 4; i++) {
    await expect(title).toHaveText(/^Rel\d+$/);
    const t = (await title.textContent())!;
    await expect(card.getByText(GENRES[Number(t.slice(3)) % 4], { exact: true })).toBeVisible();
    await expect(card.getByText(/Because you like/)).toBeVisible();
    if (i % 2 === 0) liked.push(t);
    await page.getByRole("button", { name: i % 2 === 0 ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }

  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  for (const t of liked) {
    const row = page.getByRole("link", { name: new RegExp(t) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", new RegExp(`^https://open\\.spotify\\.com/.*${t}`));
  }
  await expect(page.getByRole("link", { name: /open in/ })).toHaveCount(liked.length);
});
