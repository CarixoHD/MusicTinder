import { test, expect } from "./journey";

const readTheme = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const luminance = (colour: string) => {
      const [r, g, b] = colour.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const body = getComputedStyle(document.body);
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: body.backgroundColor,
      colour: body.color,
      contrast: contrast(body.backgroundColor, body.color),
      luminance: luminance(body.backgroundColor),
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "",
    };
  });

test("the app is paper-white in light and near-black in dark, follows the system, and keeps a chosen theme after reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();

  const light = await readTheme(page);
  expect(light.scheme).toBe("light");
  expect(light.luminance, `light background ${light.background}`).toBeGreaterThan(0.8);
  expect(light.contrast, `light contrast ${light.contrast}`).toBeGreaterThanOrEqual(4.5);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await readTheme(page)).scheme).toBe("dark");
  const dark = await readTheme(page);
  expect(dark.luminance, `dark background ${dark.background}`).toBeLessThan(0.05);
  expect(dark.contrast, `dark contrast ${dark.contrast}`).toBeGreaterThanOrEqual(4.5);
  expect(dark.themeColor.toLowerCase(), "theme-color follows the dark chrome").toBe(dark.background.replace(/^rgb\((\d+), (\d+), (\d+)\)$/, (_m, r, g, b) => "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")));

  // A deliberate choice wins over the system, and survives a reload.
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Light" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect.poll(async () => (await readTheme(page)).luminance).toBeGreaterThan(0.8);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Find something new" })).toBeVisible();
  const afterReload = await readTheme(page);
  expect(afterReload.scheme).toBe("light");
  expect(afterReload.luminance, `after reload background ${afterReload.background}`).toBeGreaterThan(0.8);

  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
});
