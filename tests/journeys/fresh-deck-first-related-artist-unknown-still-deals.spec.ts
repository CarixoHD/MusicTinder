import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("a fresh Songs deck deals a card when the first related artist is unknown to iTunes", async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now() % 1000000;
  const seedName = `Seed${stamp}`;
  const seedDeezerId = 91000000 + (stamp % 1000);
  // The first related artist Deezer suggests, which has no iTunes match at all.
  const GHOST = `Ghost${stamp}`;
  let id = stamp * 1000;

  await page.addInitScript(([json]) => {
    try { localStorage.setItem("mt:v1", json); } catch { /* about:blank */ }
  }, [JSON.stringify({
    state: {
      seeds: [{ id: "seed-fresh", kind: "artist", name: seedName, creatorKey: seedName.toLowerCase(), deezerArtistId: seedDeezerId, chips: ["electronic"] }],
      settings: { musicApp: "spotify", sound: false, theme: "system", cardType: "song" },
      taste: { chips: {}, creators: {}, origins: {} },
      liked: [],
      seen: [],
    },
    version: 1,
  })]);

  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      // Only the ghost artist has no name match: iTunes answers with another act.
      results = [{
        wrapperType: "artist",
        artistType: "Artist",
        artistName: term === GHOST ? "Someone Else" : term,
        artistId: ++id,
        primaryGenreName: "Electronic",
      }];
    } else if (entity === "song") {
      results = [1, 2, 3].map((n) => ({
        wrapperType: "track",
        kind: "song",
        trackId: ++id,
        trackName: `Dealt song ${n}`,
        artistName: `Dealt${stamp}`,
        primaryGenreName: "Electronic",
        previewUrl: `https://audio.example.test/${id}.m4a`,
      }));
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const related = u.pathname.match(/artist\/(\d+)\/related/);
    let data: object = { data: [] };
    if (related && Number(related[1]) === seedDeezerId) {
      data = {
        data: [
          { id: ++id, name: GHOST, nb_fan: 1200 },
          ...Array.from({ length: 5 }, () => ({ id: ++id, name: `Dealt${stamp}x${id}`, nb_fan: 5000 })),
        ],
      };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Dealt song \d+$/, { timeout: 20_000 });
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
  await expect(page.getByText("Your deck is getting ready")).toHaveCount(0);
});
