import { test, expect } from "./journey";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("empty Liked points to Discover; likes list there, open in the chosen music app, and survive reload", async ({ page }) => {
  const stamp = Date.now();
  let id = stamp;
  await page.route(/mzstatic\.com|dzcdn\.net/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await page.route(/itunes\.apple\.com\/(search|lookup)/, async (route) => {
    const u = new URL(route.request().url());
    const entity = u.searchParams.get("entity");
    let results: object[];
    if (u.pathname.includes("search") && entity === "musicArtist") {
      results = [{ wrapperType: "artist", artistType: "Artist", artistName: `${u.searchParams.get("term")} Band`, artistId: ++id, primaryGenreName: "Jazz" }];
    } else {
      const aid = Number(u.searchParams.get("id")) || ++id;
      results = Array.from({ length: 6 }, () => {
        const t = ++id;
        return { wrapperType: "track", kind: "song", trackId: t, trackName: `Tune ${t}`, collectionId: ++id, collectionName: `Coll ${t}`, artistName: `Maker ${aid}`, artistId: aid, artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg", primaryGenreName: "Jazz", releaseDate: "2010-01-01T00:00:00Z" };
      });
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const data = u.pathname.includes("/search")
      ? { data: [{ id: ++id, name: `${u.searchParams.get("q")} Band` }] }
      : { data: Array.from({ length: 6 }, () => ({ id: ++id, name: `Kin${id}` })) };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
  });

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Lyra${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Lyra${stamp} Band`) }).click();
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("button", { name: "Start discovering" }).click();

  const title = page.locator("article").first().getByRole("heading", { level: 2 });
  await expect(title).toHaveText(/^Tune \d+$/);

  await nav.getByRole("button", { name: "Liked" }).click();
  await expect(page.getByRole("heading", { name: "Nothing saved yet" })).toBeVisible();
  await page.getByRole("button", { name: "Go to Discover" }).click();
  await expect(title).toHaveText(/^Tune \d+$/);

  const liked: string[] = [];
  for (let i = 0; i < 2; i++) {
    const t = (await title.textContent())!;
    liked.push(t);
    await page.getByRole("button", { name: "Like", exact: true }).click();
    await expect(title).not.toHaveText(t);
  }

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "YouTube Music" }).click();
  await expect(dialog.getByRole("button", { name: "YouTube Music" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Close settings" }).click();

  await nav.getByRole("button", { name: "Liked" }).click();
  for (const t of liked) {
    const row = page.getByRole("link", { name: new RegExp(t) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("href", /^https:\/\/music\.youtube\.com\//);
    await expect(row).toHaveAttribute("href", new RegExp(t.split(" ")[1]));
  }

  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Liked" }).click();
  for (const t of liked) {
    await expect(page.getByRole("link", { name: new RegExp(t) })).toHaveAttribute("href", /music\.youtube\.com/);
  }
});
