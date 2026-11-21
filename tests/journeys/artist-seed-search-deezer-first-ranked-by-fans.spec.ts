import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("artist search lists real profiles by fans without the empty duplicate, the pick lands in view, and the deck has a sound toggle", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const itunesSearches: string[] = [];
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    if (u.searchParams.get("entity") === "musicArtist" && term.startsWith("Neon")) itunesSearches.push(term);
    const results = u.searchParams.get("entity") === "musicArtist" ? [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: ++id, primaryGenreName: "Electronic" }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const q = u.searchParams.get("q") ?? "";
    const data = u.pathname.includes("/search")
      ? { data: [
          { id: ++id, name: q, nb_fan: 9 },
          { id: ++id, name: `${q} Cover Band`, nb_fan: 2400 },
          { id: ++id, name: q, nb_fan: 812000 },
        ] }
      : { data: Array.from({ length: 6 }, () => ({ id: ++id, name: `Kin${id}`, nb_fan: 3000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const name = `Neon${stamp}`;
  await page.getByRole("searchbox", { name: "Search artists" }).pressSequentially(name, { delay: 40 });
  const results = page.getByRole("list", { name: "Search results" }).getByRole("button");
  await expect(results.first()).toHaveAccessibleName(new RegExp(`^${name} 812k fans`));
  await expect(results.nth(1)).toHaveAccessibleName(new RegExp(`^${name} Cover Band`));
  await expect(page.getByRole("button", { name: new RegExp(`^${name} 9 fans`) })).toHaveCount(0);
  expect(itunesSearches).toEqual([]);

  await results.first().click();
  await expect(page.getByRole("searchbox", { name: "Search artists" })).toHaveValue("");
  await expect(page.getByRole("button", { name: `Remove ${name}` })).toBeInViewport();
  await expect(page.getByRole("button", { name: /Start discovering with 1 seed/ })).toBeEnabled();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  await expect(card.getByText(/^Artist · /)).toBeVisible();
  await expect(card.getByText(`Because you like ${name}`)).toBeVisible();

  const sound = page.getByRole("button", { name: /^Sound o(n|ff)$/ });
  const was = await sound.getAttribute("aria-pressed");
  await sound.click();
  const now = was === "true" ? "false" : "true";
  await expect(sound).toHaveAttribute("aria-pressed", now);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Sound o(n|ff)$/ })).toHaveAttribute("aria-pressed", now);
});
