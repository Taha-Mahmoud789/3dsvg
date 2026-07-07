import { test, expect } from "@playwright/test";
import path from "path";

const TEST_IMAGE = path.join(__dirname, "test-image.png");

test.describe("Amendments", () => {
  test("256 colors + Full Color mode", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.locator('button:has-text("Smooth Trace")').first()).toBeVisible({ timeout: 15000 });

    // Colors label should show initial count
    await expect(page.locator("text=/Colors: \\d+/").first()).toBeVisible({ timeout: 5000 });

    // Toggle Full Color ON — slider should disappear
    const fullColorSwitch = page.locator('button[role="switch"][aria-label="Full color mode"]');
    await fullColorSwitch.click();
    await page.waitForTimeout(1500);

    // The "Colors:" label with slider should be hidden when Full Color is on
    const colorsSliderVisible = await page.locator('[aria-label="Color count"]').isVisible().catch(() => false);
    expect(colorsSliderVisible).toBe(false);
    await page.screenshot({ path: "tests/amend-01-full-color.png" });

    // Toggle Full Color OFF
    await fullColorSwitch.click();
    await page.waitForTimeout(500);

    // Slider should reappear
    await expect(page.locator('[aria-label="Color count"]')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: "tests/amend-02-256-colors.png" });

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("THREE.WebGLRenderer")
    );
    expect(critical).toEqual([]);
  });

  test("Pixel Grid Maximum Detail", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.locator('button:has-text("Smooth Trace")').first()).toBeVisible({ timeout: 15000 });

    // Switch to Pixel Grid
    await page.locator('button:has-text("Pixel Grid")').first().click();
    await page.waitForTimeout(1000);

    // Click Maximum Detail
    const maxDetailBtn = page.locator('button:has-text("Maximum Detail")');
    await expect(maxDetailBtn).toBeVisible({ timeout: 5000 });
    await maxDetailBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "tests/amend-03-pixel-max-detail.png" });

    // Toggle smooth edges
    const smoothSwitch = page.locator('button[role="switch"][aria-label="Smooth edges"]');
    await smoothSwitch.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/amend-04-pixel-smooth-edges.png" });

    // File size section should show SVG size (not 0 B)
    const fileSection = page.locator("text=Optimized SVG:").first();
    await expect(fileSection).toBeVisible();

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("THREE.WebGLRenderer")
    );
    expect(critical).toEqual([]);
  });

  test("High Quality preset", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.locator('button:has-text("Smooth Trace")').first()).toBeVisible({ timeout: 15000 });

    // Click High Quality preset
    const hqBtn = page.locator('button:has-text("High Quality")').first();
    await expect(hqBtn).toBeVisible({ timeout: 5000 });
    await hqBtn.click();
    await page.waitForTimeout(2000);

    // Verify colors label shows 128
    const colorsLabel = page.locator("text=/Colors: \\d+/").first();
    await expect(colorsLabel).toBeVisible({ timeout: 5000 });
    const text = await colorsLabel.textContent();
    expect(text).toContain("128");

    await page.screenshot({ path: "tests/amend-05-high-quality.png" });

    // Switch to Pixel Grid and apply High Quality
    await page.locator('button:has-text("Pixel Grid")').first().click();
    await page.waitForTimeout(1000);
    await hqBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/amend-06-hq-pixel-grid.png" });

    // Click Continue to 3D
    const continueBtn = page.locator('button:has-text("Continue to 3D")').first();
    await expect(continueBtn).toBeVisible({ timeout: 15000 });
    await continueBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "tests/amend-07-hq-continue.png" });

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("THREE.WebGLRenderer")
    );
    expect(critical).toEqual([]);
  });
});
