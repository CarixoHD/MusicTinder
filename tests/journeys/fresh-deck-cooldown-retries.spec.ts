import { test, expect } from "./journey";
import { BUDGET_WINDOW_MS } from "../../src/catalog/budget";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("a fresh artist deck whose first related artists are unknown pauses calmly and deals once the iTunes window refills", async ({ page }) => {
  // The budget window is real browser time; fast-forward it instead of waiting
  // out the minute the cool-down retry is meant to survive.
  await page.clock.install();
  const stamp = Date.now() % 1000000;
  const seedName = `Cool${stamp}`;
  const seedDeezerId = 92000000 + (stamp % 1000);
  const ghosts = Array.from({ length: 6 }, (_, i) => `Ghost${stamp}x${i}`);
  const tagged = Array.from({ length: 4 }, (_, i) => `Tagged${stamp}x${i}`);
  let id = stamp * 1000;

  await page.addInitScript(([json]) => {
    try { localStorage.setItem("mt:v1", json); } catch { /* about:blank */ }
  }, [JSON.stringify({
    state: {
      seeds: [{ id: "seed-cool", kind: "artist", name: seedName, creatorKey: seedName.toLowerCase(), deezerArtistId: seedDeezerId, chips: ["electronic"] }],
      settings: { musicApp: "spotify", sound: false, theme: "system", cardType: "artist" },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
      seen: [],
    },
    version: 1,
  })]);

  await page.route(/mzstatic\.com|e-cdns-images\.dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    // The first related artists have no name match in iTunes at all; the later
    // ones are only reachable once the allowance is back.
    const isGhost = ghosts.includes(term);
    const results = [{
      wrapperType: "artist",
      artistType: "Artist",
      artistName: isGhost ? "Someone Else" : term,
      artistId: ++id,
      primaryGenreName: "Rock",
    }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  // Hold the related list until the allowance has been spent, so generation
  // meets the cool-down a long session would leave behind.
  let releaseRelated!: () => void;
  const heldRelated = new Promise<void>((resolve) => { releaseRelated = resolve; });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const related = u.pathname.match(/artist\/(\d+)\/related/);
    let data: object = { data: [] };
    if (related && Number(related[1]) === seedDeezerId) {
      await heldRelated;
      data = { data: [...ghosts, ...tagged].map((name) => ({ id: ++id, name, nb_fan: 4000 })) };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");

  // Nine of seventeen requests already spent: the six waited lookups run, the
  // remaining artists are refused by the cool-down.
  await page.evaluate(async (spend) => {
    const url = "/src/catalog/budget.ts";
    const budget = await import(/* @vite-ignore */ url);
    await Promise.all(
      Array.from({ length: spend }, () => budget.withItunesBudget(null, async () => null)),
    );
  }, 9);
  releaseRelated();

  const calm = page.getByRole("heading", { name: "Still looking" });
  await expect(calm).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Trying again in a moment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  // Neither the seed-blaming copy nor the outage copy: those would both be lies.
  await expect(page.getByText("Nothing to recommend from these seeds yet")).toHaveCount(0);
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
  await expect(page.getByText("Check your connection, then try again.")).toHaveCount(0);

  // The notice retries on its own once the iTunes window is back, with no
  // click from the listener, and the artists it never checked now deal.
  await page.clock.runFor(BUDGET_WINDOW_MS);
  await expect(page.locator("article").first().getByRole("heading", { level: 2 })).toHaveText(/^Tagged/, { timeout: 20_000 });
  await expect(calm).toHaveCount(0);
});
