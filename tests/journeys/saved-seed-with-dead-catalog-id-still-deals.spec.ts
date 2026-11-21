import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("a returning listener whose saved seed points at an empty catalog profile still gets a deck", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  const DEAD = 70000000 + stamp;
  const LIVE = 80000000 + stamp;
  const name = `Midnight${stamp}`;
  let id = stamp * 1000;
  await page.addInitScript(([json]) => {
    try { if (!sessionStorage.getItem("primed")) { localStorage.setItem("mt:v1", json); sessionStorage.setItem("primed", "1"); } } catch { /* about:blank */ }
  }, [JSON.stringify({
    state: {
      seeds: [{ id: "seed-dead", kind: "artist", name, creatorKey: name.toLowerCase(), deezerArtistId: DEAD, chips: ["electronic"] }],
      settings: { musicApp: "spotify", sound: false, theme: "system", cardType: "artist" },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
      seen: [],
    },
    version: 1,
  })]);
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    const results = u.searchParams.get("entity") === "musicArtist" ? [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: ++id, primaryGenreName: "Electronic" }] : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    let data: object = { data: [] };
    if (u.pathname.includes("/search")) data = { data: [{ id: LIVE, name: u.searchParams.get("q"), nb_fan: 300000 }] };
    else if (u.pathname.includes(`/artist/${LIVE}/related`)) data = { data: Array.from({ length: 6 }, () => ({ id: ++id, name: `Drive${id}`, nb_fan: 4000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Drive\d+$/, { timeout: 20_000 });
  await expect(card.getByText(`Because you like ${name}`)).toBeVisible();
  await expect(page.getByText("Nothing to recommend from these seeds yet")).toHaveCount(0);
  const t = (await title.textContent())!;
  await page.keyboard.press("ArrowRight");
  await expect(title).not.toHaveText(t);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${t}, Artist`) })).toHaveAttribute("href", new RegExp(`^https://open\\.spotify\\.com/.*${t}`));
});
