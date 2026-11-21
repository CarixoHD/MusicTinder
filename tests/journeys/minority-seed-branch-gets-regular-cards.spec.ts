import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("with three electronic seeds and one R&B seed, the minority branch is still dealt regularly in the first cards", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now() % 1000000;
  const idByName = new Map<string, number>();
  const nameById = new Map<number, string>();
  let id = stamp * 1000;
  const nid = (name: string) => {
    if (!idByName.has(name)) { const v = ++id; idByName.set(name, v); nameById.set(v, name); }
    return idByName.get(name)!;
  };
  const seeds = [
    { id: "seed-e1", kind: "artist", name: `ElA${stamp}`, creatorKey: `ela${stamp}`, deezerArtistId: 8100001, chips: ["electronic"] },
    { id: "seed-e2", kind: "artist", name: `ElB${stamp}`, creatorKey: `elb${stamp}`, deezerArtistId: 8100002, chips: ["electronic"] },
    { id: "seed-e3", kind: "artist", name: `ElC${stamp}`, creatorKey: `elc${stamp}`, deezerArtistId: 8100003, chips: ["electronic"] },
    { id: "seed-soul", kind: "artist", name: `SoulSeed${stamp}`, creatorKey: `soulseed${stamp}`, deezerArtistId: 8100004, chips: ["r&b-soul"] },
  ];
  const seedNameByDeezerId = new Map(seeds.map((s) => [s.deezerArtistId, s.name]));
  for (const s of seeds) { idByName.set(s.name, s.deezerArtistId); nameById.set(s.deezerArtistId, s.name); }

  await page.addInitScript(([json]) => {
    try { localStorage.setItem("mt:v1", json); } catch { /* about:blank */ }
  }, [JSON.stringify({
    state: { seeds, settings: { musicApp: "spotify", sound: false, theme: "system", cardType: "artist" }, taste: { chips: {}, creators: {}, origins: {} }, liked: [], seen: [] },
    version: 1,
  })]);

  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const term = u.searchParams.get("term") ?? "";
    const isSoul = term.startsWith("SoulKin");
    const genre = isSoul ? "R&B/Soul" : "Electronic";
    const results = u.searchParams.get("entity") === "musicArtist"
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: term, artistId: nid(term), primaryGenreName: genre }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    let data: object = { data: [] };
    if (u.pathname.includes("/search/artist")) {
      const q = u.searchParams.get("q") ?? "";
      data = { data: [{ id: nid(q), name: q, nb_fan: 90000 }] };
    } else if (u.pathname.includes("/related")) {
      const m = u.pathname.match(/artist\/(\d+)\/related/);
      const seedName = nameById.get(Number(m?.[1])) ?? "";
      const isSoul = seedName.startsWith("Soul");
      const prefix = isSoul ? "SoulKin" : `ElKin${seedName.slice(-1)}`;
      data = { data: Array.from({ length: 8 }, (_, i) => { const name = `${prefix}${i}`; return { id: nid(name), name, nb_fan: 5000 }; }) };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  const dealt: string[] = [];
  for (let i = 0; i < 12; i++) {
    const t = await title.textContent({ timeout: 20_000 }).catch(() => null);
    if (!t) break;
    dealt.push(t);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  expect(dealt.length, `cards dealt: ${dealt.join(", ")}`).toBeGreaterThanOrEqual(8);
  expect(dealt.slice(0, 6).some((t) => t.startsWith("SoulKin")), `first six cards: ${dealt.slice(0, 6).join(", ")}`).toBe(true);
  expect(dealt.slice(0, 12).filter((t) => t.startsWith("SoulKin")).length, `first twelve cards: ${dealt.join(", ")}`).toBeGreaterThanOrEqual(2);
});
