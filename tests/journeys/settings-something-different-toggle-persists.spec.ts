import { test, expect } from "./journey";

test("Settings offers a Something different switch that starts on, turns off, and stays off after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  const sw = page.getByRole("switch", { name: "Something different" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  const afterReload = page.getByRole("switch", { name: "Something different" });
  await expect(afterReload).toHaveAttribute("aria-checked", "false");

  await afterReload.click();
  await expect(afterReload).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("switch", { name: "Something different" })).toHaveAttribute("aria-checked", "true");
});
