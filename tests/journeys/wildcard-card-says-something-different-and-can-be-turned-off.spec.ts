import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("about one card in six is a Something different wildcard, outside the usual genre, and the switch turns it off", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now() % 1000000;
  const seedName = `Neon${stamp}`;
  const seedDeezerId = 7700000 + (stamp % 1000);
  let id = stamp * 1000;
  const entity = new Map();
  const put = (o: Record<string, unknown>) => { const e = { ...o, id: (o.id as number) ?? ++id }; entity.set(String(e.id), e); return e as any; };
  const genreOf = (term: string) => {
    const l = term.toLowerCase();
    if (l.includes("hip-hop") || l.includes("hip hop")) return "Hip-Hop";
    if (l.includes("rock")) return "Rock";
    if (l.includes("dance")) return "Dance";
    if (l.includes("classical")) return "Classical";
    if (l.includes("soul") || l.includes("r&b")) return "R&B/Soul";
    return "Electronic";
  };
  const artistFor = (name: string) => {
    for (const e of entity.values()) if (e.kind === "artist" && e.name === name) return e;
    return put({ kind: "artist", name, genre: genreOf(name) });
  };
  const songsOf = (a: any) => {
    if (!a.songs) a.songs = [1, 2, 3].map((n) => put({ kind: "song", name: `${a.name} Song${n}`, genre: a.genre, artistName: a.name, artistId: a.id, collectionName: `${a.name} LP`, year: 2012 }));
    return a.songs;
  };
  const artistJson = (a: any) => ({ wrapperType: "artist", artistType: "Artist", artistName: a.name, artistId: a.id, primaryGenreName: a.genre });
  const songJson = (s: any) => ({ wrapperType: "track", kind: "song", trackId: s.id, trackName: s.name, collectionId: s.artistId, collectionName: s.collectionName, artistName: s.artistName, artistId: s.artistId, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: s.genre, releaseDate: "2012-01-01T00:00:00Z" });

  await page.addInitScript(([json]) => {
    try { if (!sessionStorage.getItem("primed")) { localStorage.setItem("mt:v1", json); sessionStorage.setItem("primed", "1"); } } catch { /* about:blank */ }
  }, [JSON.stringify({
    state: {
      seeds: [{ id: "seed-wild", kind: "artist", name: seedName, creatorKey: seedName.toLowerCase(), deezerArtistId: seedDeezerId, chips: ["electronic"] }],
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
    if (u.pathname.includes("search")) {
      if (kind === "musicArtist") results = [artistJson(artistFor(term))];
      else if (kind === "album") results = [1, 2].map((n) => { const a = artistFor(term); return { wrapperType: "collection", collectionType: "Album", collectionId: a.id * 10 + n, collectionName: `${a.name} LP${n}`, artistName: a.name, artistId: a.id, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: a.genre, releaseDate: "2015-01-01T00:00:00Z" }; });
      else if (kind === "song") results = songsOf(artistFor(term)).map(songJson);
    } else {
      const target = idp ? entity.get(String(idp)) : null;
      if (kind === "song" && target && target.kind === "artist") results = songsOf(target).map(songJson);
      else if (kind === "album" && target && target.kind === "artist") results = [1, 2].map((n) => ({ wrapperType: "collection", collectionType: "Album", collectionId: target.id * 10 + n, collectionName: `${target.name} LP${n}`, artistName: target.name, artistId: target.id, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: target.genre, releaseDate: "2015-01-01T00:00:00Z" }));
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    let data: object = { data: [] };
    if (u.pathname.includes("/search/artist")) {
      const q = u.searchParams.get("q") ?? "";
      const a = artistFor(q);
      data = { data: [{ id: a.id, name: q, nb_fan: 90000 }] };
    } else if (u.pathname.includes("/related")) {
      const m = u.pathname.match(/artist\/(\d+)\/related/);
      const own = entity.get(m?.[1]);
      const base = own ? own.name : "X";
      data = { data: Array.from({ length: 5 }, (_, i) => { const a = artistFor(`${base}Kin${i}`); return { id: a.id, name: a.name, nb_fan: 5000 }; }) };
    }
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });

  const wild: { title: string; text: string }[] = [];
  let dealt = 0;
  for (let i = 0; i < 12; i++) {
    const t = await title.textContent({ timeout: 20_000 }).catch(() => null);
    if (!t) break;
    dealt += 1;
    const text = await card.innerText();
    if (text.includes("Something different")) wild.push({ title: t, text });
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  expect(dealt, "cards dealt before the deck ended").toBeGreaterThanOrEqual(6);
  expect(wild.length, `wildcards in the first ${dealt} cards`).toBeGreaterThanOrEqual(1);
  for (const w of wild) {
    expect(w.title, "a wildcard comes from outside the seed's usual branch").not.toMatch(/Kin/);
    expect(w.text, "the wildcard line replaces the because line").not.toMatch(/Because you like/);
    expect(w.text).toMatch(/Something different/);
  }

  // Turn wildcards off; a fresh reload must not deal any more of them.
  await page.getByRole("button", { name: "Open settings" }).click();
  const sw = page.getByRole("switch", { name: "Something different" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();

  let dealtOff = 0;
  for (let i = 0; i < 12; i++) {
    const t = await title.textContent({ timeout: 20_000 }).catch(() => null);
    if (!t) break;
    dealtOff += 1;
    await expect(card.getByText("Something different")).toHaveCount(0);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  expect(dealtOff, "cards dealt with wildcards off").toBeGreaterThanOrEqual(3);
});
