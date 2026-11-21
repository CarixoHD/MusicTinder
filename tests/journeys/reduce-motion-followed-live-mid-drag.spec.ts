import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("turning Reduce Motion on while the deck is open stops the card rotating on drag, without a reload", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    let results: object[];
    if (u.pathname.includes("search") && u.searchParams.get("entity") === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Folk" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => { const t = ++id; return { wrapperType: "track", kind: "song", trackId: t, trackName: `Live${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Folk", releaseDate: "2009-01-01T00:00:00Z" }; });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search") ? { data: [{ id: ++id, name: `Tide${stamp} Band` }] } : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Tide${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Tide${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const card = page.locator("article").first();
  const title = card.getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Live\d+$/);

  const rotation = () => card.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    let max = 0;
    while (n && n.tagName !== "MAIN") {
      const m = getComputedStyle(n).transform.match(/^matrix\(([^)]+)\)$/);
      if (m) max = Math.max(max, Math.abs(Number(m[1].split(",")[1])));
      n = n.parentElement;
    }
    return max;
  });
  const dragRightAndHold = async () => {
    const b = (await card.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + b.height / 3, { steps: 2 });
  };
  const release = async () => {
    const b = (await card.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3, { steps: 6 });
    await page.mouse.up();
  };

  await dragRightAndHold();
  await expect.poll(rotation).toBeGreaterThan(0.01);
  await release();
  await expect(title).toHaveText(/^Live\d+$/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await dragRightAndHold();
  await expect.poll(rotation).toBeLessThanOrEqual(0.001);
  await release();

  const current = (await title.textContent())!;
  await page.getByRole("button", { name: "Like", exact: true }).click();
  await expect(title).not.toHaveText(current);
});
