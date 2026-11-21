import { test, expect } from "./journey";
import { mockCatalog } from "../../e2e/fixtures";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** A dealt deck persisted the way a running session leaves it (artist cards). */
const SEED_STATE = JSON.stringify({
  state: {
    seeds: [
      {
        id: "seed-ada",
        kind: "artist",
        name: "Ada Vale",
        creatorKey: "ada vale",
        itunesArtistId: 9101,
        deezerArtistId: 4101,
        chips: ["electronic", "ambient"],
      },
    ],
    settings: { musicApp: "spotify", sound: false, theme: "system", cardType: "artist" },
    taste: { chips: {}, creators: {}, origins: {} },
    liked: [],
    seen: [],
  },
  version: 1,
});

test("when the catalog is down as the deck deals, the listener sees 'Couldn’t reach the catalog' with Retry, not a fake end of deck", async ({ page }) => {
  const stamp = Date.now();
  let down = false;
  await page.route(/itunes\.apple\.com/, async (route) => {
    if (down) return route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<html>gateway hiccup</html>" });
    const term = new URL(route.request().url()).searchParams.get("term") ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: 1, results: [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: stamp, primaryGenreName: "Jazz" }] }) });
  });
  await page.route(/api\.deezer\.com/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "/* outage */" }));

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Outage${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Outage${stamp} Band`) }).click();
  down = true;
  await page.getByRole("button", { name: "Start discovering" }).click();

  await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("That’s everything in this direction")).toHaveCount(0);
});

test("a mid-session outage that drains the dealt cards offers Retry instead of a fake end of deck", async ({ page }) => {
  await mockCatalog(page, { enrichRelatedArtists: true });
  await page.route(/cdn\.example\.test/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  let down = false;
  await page.route(/itunes\.apple\.com|api\.deezer\.com/, (route) => {
    if (!down) return route.fallback();
    const itunes = new URL(route.request().url()).host === "itunes.apple.com";
    return route.fulfill({
      status: 200,
      contentType: itunes ? "text/html" : "application/javascript",
      headers: { "access-control-allow-origin": "*" },
      body: itunes ? "<html>gateway hiccup</html>" : "/* outage */",
    });
  });
  await page.addInitScript((json) => {
    try {
      localStorage.setItem("mt:v1", json);
    } catch {
      // about:blank has no storage; the navigation runs this again.
    }
  }, SEED_STATE);

  await page.goto("/");
  const title = page.locator(".deck__current .card__title");
  await expect(title).toHaveText(/\S/);

  // The network dies after the deck has dealt; the cards in hand keep swiping.
  down = true;
  for (let i = 0; i < 20; i += 1) {
    if ((await title.count()) === 0) break;
    const before = await title.innerText();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => ((await title.count()) === 0 ? null : title.innerText()))
      .not.toBe(before);
  }

  // Running out of dealt cards while offline is a catalog failure, not the end
  // of the deck — not even for the moment the failed refill takes to answer.
  await expect(page.getByText("That’s everything in this direction")).toHaveCount(0);
  await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
