import { test, expect } from "./journey";

test("when the catalog is down as the deck deals, the listener sees 'Couldn't reach the catalog' with Retry, not a fake end of deck", async ({ page }) => {
  const stamp = Date.now();
  let down = false;
  await page.route(/itunes\.apple\.com/, async (route) => {
    if (down) return route.fulfill({ status: 200, contentType: "text/html", headers: { "access-control-allow-origin": "*" }, body: "<html>gateway hiccup</html>" });
    const term = new URL(route.request().url()).searchParams.get("term") ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: 1, results: [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: stamp, primaryGenreName: "Jazz" }] }) });
  });
  await page.route(/api\.deezer\.com/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "/* outage */" }));

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Outage${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Outage${stamp} Band`) }).click();
  down = true;
  await page.getByRole("button", { name: "Start discovering" }).click();

  await expect(page.getByText("Couldn't reach the catalog")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText("That's everything in this direction")).toHaveCount(0);
});
