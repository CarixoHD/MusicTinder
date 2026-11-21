import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("on a phone browser viewport a card with a long title keeps Like and Skip fully above the tab bar", async ({ page }) => {
  const stamp = Date.now() % 1000000;
  let id = stamp * 100;
  // A 375x553 viewport is an iPhone SE / 8 in Safari with its chrome showing.
  await page.setViewportSize({ width: 375, height: 553 });
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    let results: object[] = [];
    if (entity === "musicArtist") results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    else if (entity === "song") results = [{ wrapperType: "track", kind: "song", trackId: ++id, trackName: "The Long And Winding Song Title That Wraps Across The Phone Screen", artistId: ++id, artistName: "The Correspondingly Long Artist Name That Also Wraps On The Card", collectionId: ++id, collectionName: "Coll", artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", previewUrl: `https://audio-ssl.itunes.apple.com/p${id}.m4a`, releaseDate: "2012-01-01T00:00:00Z" }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band`, nb_fan: 90000 }] }
      : { data: Array.from({ length: 8 }, () => ({ id: ++id, name: `Kin${id}`, nb_fan: 4000 })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Fit${stamp}`);
  await page.getByRole("button", { name: new RegExp(`^Fit${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: /Start discovering/ }).click();
  await expect(page.locator("article").first().getByRole("heading", { level: 2 })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const byName = (name: string) =>
      [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent.trim()) === name)!;
    const like = byName("Like").getBoundingClientRect();
    const skip = byName("Skip").getBoundingClientRect();
    const nav = document.querySelector("nav")!.getBoundingClientRect();
    const centre = document.elementFromPoint(like.left + like.width / 2, like.top + like.height / 2);
    return {
      likeBottom: Math.round(like.bottom),
      skipBottom: Math.round(skip.bottom),
      navTop: Math.round(nav.top),
      viewportHeight: window.innerHeight,
      atLikeCentre: (centre?.getAttribute("aria-label") || centre?.textContent || "").trim(),
    };
  });
  expect(metrics.likeBottom, `Like ends at ${metrics.likeBottom}px, tab bar starts at ${metrics.navTop}px`).toBeLessThanOrEqual(metrics.navTop);
  expect(metrics.skipBottom, `Skip ends at ${metrics.skipBottom}px, tab bar starts at ${metrics.navTop}px`).toBeLessThanOrEqual(metrics.navTop);
  expect(metrics.likeBottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.atLikeCentre, `a tap at the middle of Like hits ${JSON.stringify(metrics.atLikeCentre)}`).toBe("Like");
});
