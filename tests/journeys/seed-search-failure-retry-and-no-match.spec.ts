import { test, expect } from "./journey";

test("seed search explains a catalog failure inline, retries, and flags no match", async ({ page }) => {
  const stamp = Date.now();
  let fail = true;
  await page.route(/itunes\.apple\.com/, async (route) => {
    const term = new URL(route.request().url()).searchParams.get("term") ?? "";
    // A catalog blip: garbled response (a failed HTTP status would itself log a browser console error).
    if (fail) return route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<html>gateway hiccup</html>" });
    const results = term.startsWith("Nothing")
      ? []
      : [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: stamp, primaryGenreName: "Jazz" }];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });
  // Artist search is Deezer-first: the blip and the answers come from here. A
  // Deezer "error" payload is how the typed JSONP failure reaches the app.
  await page.route(/api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    const cb = u.searchParams.get("callback");
    const payload = fail
      ? { error: { type: "DataException", message: "quota", code: 4 } }
      : {
          data: (u.searchParams.get("q") ?? "").startsWith("Nothing")
            ? []
            : [{ id: stamp, name: `${u.searchParams.get("q")} Band` }],
        };
    await route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(payload)})` });
  });

  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Search artists" });
  await box.fill(`Delta${stamp}`);
  await expect(page.getByText("Couldn’t reach the catalog")).toBeVisible();

  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  const hit = page.getByRole("button", { name: new RegExp(`Delta${stamp} Band`) });
  await expect(hit).toBeVisible();
  await expect(page.getByText("Couldn’t reach the catalog")).toBeHidden();
  await hit.click();
  await expect(page.getByRole("button", { name: `Remove Delta${stamp} Band` })).toBeVisible();

  await box.fill(`Nothing${stamp}`);
  await expect(page.getByText(/No match/)).toBeVisible();
});
