import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAABAAAAAQCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("a very long sample title is truncated with an ellipsis and never makes the page scroll sideways", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  const longTitle = `An Extremely Long Live Performance Recording Of A Song Nobody Can Name In Full ${stamp} Extended Remastered Edition`;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: /^Kin\d+$/.test(term) ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else if (entity === "song") {
      const t = ++id;
      results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: t === id ? longTitle : `Sample ${t}`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }];
      if (id === t) id = t;
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, () => { const d = ++id; return { id: d, name: `Kin${d}`, nb_fan: 40000 }; }) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Long${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Long${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();

  const card = page.locator("article").first();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText(/^Kin\d+$/, { timeout: 20_000 });
  const line = card.getByText(new RegExp(longTitle.slice(0, 40)));
  await expect(line).toBeVisible({ timeout: 20_000 });
  const play = card.getByRole("button", { name: new RegExp(`^Play sample: ${longTitle.slice(0, 30)}`) });
  await expect(play).toBeVisible();
  for (const size of [{ width: 1280, height: 600 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { timeout: 10_000 }).toBe(true);
    const style = await line.evaluate((el) => { const s = getComputedStyle(el); return { textOverflow: s.textOverflow, whiteSpace: s.whiteSpace, overflow: s.overflow, clientW: (el as HTMLElement).clientWidth, scrollW: (el as HTMLElement).scrollWidth, h: el.getBoundingClientRect().height, lh: parseFloat(s.lineHeight) || 0 }; });
    expect(style.textOverflow, `at ${size.width}px: ${JSON.stringify(style)}`).toBe("ellipsis");
    expect(style.scrollW, `at ${size.width}px: ${JSON.stringify(style)}`).toBeGreaterThan(style.clientW);
    if (style.lh) expect(style.h, `at ${size.width}px: ${JSON.stringify(style)}`).toBeLessThan(style.lh * 1.8);
    const like = (await page.getByRole("button", { name: "Like", exact: true }).boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
    expect(like.y + like.height, `at ${size.width}px: Like bottom vs tab bar`).toBeLessThanOrEqual(nav.y + 1);
  }
});
