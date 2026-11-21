import { test, expect } from "./journey";

test("listener picks a theme that survives reload, and resets all data only after confirming", async ({ page }) => {
  const stamp = Date.now();
  await page.route(/itunes\.apple\.com|api\.deezer\.com/, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.includes("deezer")) {
      const cb = u.searchParams.get("callback");
      const data = u.pathname.includes("/search")
        ? { data: [{ id: stamp, name: `${u.searchParams.get("q")} Band` }] }
        : { data: [] };
      return route.fulfill({ status: 200, contentType: "application/javascript", body: `${cb}(${JSON.stringify(data)})` });
    }
    const term = u.searchParams.get("term") ?? "";
    const results = u.searchParams.get("entity") === "musicArtist" && term.startsWith("Reset")
      ? [{ wrapperType: "artist", artistType: "Artist", artistName: `${term} Band`, artistId: stamp, primaryGenreName: "Jazz" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ resultCount: results.length, results }) });
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search artists" }).fill(`Reset${stamp}`);
  await page.getByRole("button", { name: new RegExp(`Reset${stamp} Band`) }).click();
  await expect(page.getByRole("button", { name: `Remove Reset${stamp} Band` })).toBeVisible();

  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Light" }).click();
  await expect(dialog.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  // seeds survived: the app no longer opens on first-run Setup
  await expect(page.getByRole("button", { name: "Change seeds" })).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

  // cancel keeps data
  await page.getByRole("button", { name: "Reset all my data" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Change seeds" }).click();
  await expect(page.getByRole("button", { name: `Remove Reset${stamp} Band` })).toBeVisible();

  // confirm wipes it
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Reset all my data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove Reset${stamp} Band` })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start discovering" })).toBeDisabled();
});
