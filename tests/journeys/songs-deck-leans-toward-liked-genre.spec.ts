import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("on a Songs deck, liking Jazz songs and skipping Metal ones deals the Jazz ones first, with no repeats", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const genreOf: Record<number, string> = {};
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      const g = term.startsWith("Met") ? "Metal" : term.startsWith("Jaz") ? "Jazz" : "Rock";
      const a = ++id; genreOf[a] = g;
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: /Kin/.test(term) ? term : `${term} Band`, artistId: a, primaryGenreName: g }];
    } else {
      let aid = Number(u.searchParams.get("id"));
      if (!aid) { aid = ++id; genreOf[aid] = term.startsWith("Met") ? "Metal" : "Jazz"; }
      const g = genreOf[aid] ?? "Rock";
      results = Array.from({ length: 2 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `${g}Song${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: g, releaseDate: "2012-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 10 }, (_, i) => { const d = ++id; return { id: d, name: `${i % 2 ? "Jaz" : "Met"}Kin${d}` }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Neutral${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Neutral${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  const dealt: string[] = [];
  for (let i = 0; i < 8; i++) {
    await expect(title).toHaveText(/^(Jazz|Metal)Song\d+$/, { timeout: 20_000 });
    const t = (await title.textContent())!;
    expect(dealt).not.toContain(t);
    dealt.push(t);
    await page.getByRole("button", { name: t.startsWith("Jazz") ? "Like" : "Skip", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }
  const late = dealt.slice(3);
  expect(late.filter((t) => t.startsWith("Metal")).length, `cards 4-8: ${late.join(", ")}`).toBeLessThanOrEqual(1);
});
