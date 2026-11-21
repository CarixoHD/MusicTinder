import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("on a healthy network a fresh deck deals even when the first related artist has no iTunes match", async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now() % 1000000;
  const seedName = `Fresh${stamp}`;
  const seedDeezerId = 7990000 + (stamp % 1000);
  const GHOST = `Ghost${stamp}`;
  let id = stamp * 1000;
  const ids = new Map<string, number>();
  const nid = (n: string) => { if (!ids.has(n)) ids.set(n, ++id); return ids.get(n)!; };
  const nameOf = (v: number) => [...ids.entries()].find(([, i]) => i === v)?.[0] ?? "";

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
    const kind = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    const idp = u.searchParams.get("id");
    let results: object[] = [];
    const song = (name: string, n: number) => ({ wrapperType: "track", kind: "song", trackId: nid(`${name} S${n}`), trackName: `${name} Song${n}`, artistName: name, artistId: nid(name), collectionId: nid(`${name} C`), collectionName: "C", primaryGenreName: "Electronic", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", releaseDate: "2012-01-01T00:00:00Z" });
    if (u.pathname.includes("search")) {
      if (kind === "musicArtist") {
        results = [{ wrapperType: "artist", artistType: "Artist", artistName: term === GHOST ? "Someone Else" : term, artistId: nid(term), primaryGenreName: "Electronic" }];
      } else if (kind === "song") {
        results = [1, 2, 3].map((n) => song(term, n));
      }
    } else if (kind === "song") {
      const name = nameOf(Number(idp));
      results = [1, 2, 3].map((n) => song(name || "Someone", n));
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    let data: object = { data: [] };
    if (u.pathname.includes("/search/artist")) {
      const q = u.searchParams.get("q") ?? "";
      data = { data: [{ id: q === seedName ? seedDeezerId : nid(q), name: q, nb_fan: 90000 }] };
    } else if (u.pathname.includes("/related")) {
      data = { data: [GHOST, ...Array.from({ length: 5 }, (_, i) => `Valid${stamp}x${i}`)].map((n) => ({ id: nid(n), name: n, nb_fan: 4000 })) };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(new RegExp(`^Valid${stamp}x\\d+ Song\\d+$`), { timeout: 20_000 });
  await expect(page.getByText("Couldn’t reach the catalog")).toHaveCount(0);
  await expect(page.getByText(/Still looking/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "That’s everything in this direction" })).toHaveCount(0);

  const first = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(first);
});
