import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("after a reload the deck resumes with unseen cards, still leaning to the genre that was liked", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 1000;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    // Every related artist is either Jazz or Metal, and the deck's own cards
    // carry that genre so the taste vector can move with each swipe.
    const results = entity === "musicArtist"
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: /^Jaz/.test(term) ? "Jazz" : "Metal" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  const related = Array.from({ length: 14 }, (_, i) => ({ id: ++id, name: `${i % 2 ? "Jaz" : "Met"}Kin${i}`, nb_fan: 5000 }));
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 90000 }] }
      : { data: related };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Taste${stamp}`);
  await page.getByRole("button", { name: new RegExp(`^Taste${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^(Jaz|Met)Kin\d+$/);
  const swiped: string[] = [];
  let likedArtist = "";
  for (let i = 0; i < 4; i++) {
    const t = (await title.textContent())!;
    swiped.push(t);
    const jazz = t.startsWith("Jaz");
    if (jazz) likedArtist = t;
    await page.getByRole("button", { name: jazz ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  expect(likedArtist, `swiped: ${swiped.join(", ")}`).not.toBe("");

  // A page reload is the same device, same listener: taste and history stay.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Find something new" })).toHaveCount(0);
  await expect(title).toHaveText(/^(Jaz|Met)Kin\d+$/);
  const afterReload = (await title.textContent())!;
  expect(swiped, `card after reload: ${afterReload}`).not.toContain(afterReload);
  // The card is explained by a liked artist, not by the seed alone: the like's
  // weight survived the reload.
  await expect(page.locator("article").first().getByText(`Because you like ${likedArtist}`)).toBeVisible();

  // Four more cards: none of them repeat anything already judged.
  const dealt = [afterReload];
  for (let i = 0; i < 3; i++) {
    const t = (await title.textContent())!;
    await page.getByRole("button", { name: t.startsWith("Jaz") ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(t);
    const next = (await title.textContent().catch(() => null)) ?? "";
    if (next) dealt.push(next);
  }
  for (const t of dealt) expect(swiped, `dealt after reload: ${dealt.join(", ")}`).not.toContain(t);
  expect(new Set(dealt).size, `dealt after reload: ${dealt.join(", ")}`).toBe(dealt.length);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${likedArtist}, Artist`) })).toBeVisible();
});
