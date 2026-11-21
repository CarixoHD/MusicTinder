import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
function wav() {
  const sr = 8000, n = sr * 2, b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}

test("a superstar related artist with 80 million fans is still dealt alongside the obscure ones", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  const WAV = wav();
  const famous = `Superstar${stamp}`;
  const related = [
    { id: famous, name: famous, nb_fan: 80000000 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `Kin${stamp}${i}`, name: `Kin${stamp}${i}`, nb_fan: 1200 })),
  ];
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/audio-ssl\.itunes\.apple\.com\/.*\.m4a/, (r) => r.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    const term = u.searchParams.get("term") ?? "";
    let results: object[] = [];
    if (entity === "musicArtist") results = [{ wrapperType: "artist", artistType: "Artist", artistName: term.startsWith("Kin") || term === famous ? term : `${term} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    else if (entity === "song") { const t = ++id; results = [{ wrapperType: "track", kind: "song", trackId: t, trackName: `${term} sample`, artistId: ++id, artistName: term, collectionId: ++id, collectionName: "C", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${t}.m4a`, releaseDate: "2010-01-01T00:00:00Z" }]; }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 2000000 }] } : { data: related };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Super${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Super${stamp} Band`) }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/\S/, { timeout: 20_000 });
  const dealt: string[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (await title.textContent())!;
    dealt.push(t);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect.poll(async () => ((await title.count()) === 0 ? null : await title.textContent()), { timeout: 20_000 }).not.toBe(t);
  }
  expect(dealt, `cards dealt: ${dealt.join(", ")}`).toContain(famous);
  expect(dealt.filter((t) => t.startsWith("Kin")).length, `cards dealt: ${dealt.join(", ")}`).toBeGreaterThanOrEqual(4);
});
