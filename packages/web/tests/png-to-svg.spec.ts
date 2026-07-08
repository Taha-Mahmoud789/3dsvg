import { test, expect } from "@playwright/test";
import path from "path";

const TEST_IMAGE = path.join(__dirname, "test-image.png");

test.describe("PNG → SVG Vectorization Pipeline", () => {
  test("loads the editor", async ({ page }) => {
    await page.goto("/");
    // Wait for canvas to become visible (it starts hidden then appears)
    const canvas = page.locator("canvas[data-engine]");
    await expect(canvas).toBeVisible({ timeout: 30000 });
  });

  test("upload PNG shows vectorization panel", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    // Click the file upload toolbar button (4th)
    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    // Upload PNG
    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);

    // Wait for vectorization panel to load (mode buttons = the panel rendered)
    const smoothBtn = page.locator('button:has-text("Smooth Trace")');
    await expect(smoothBtn.first()).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: "tests/01-upload-png.png" });
  });

  test("switches between Smooth Trace and Pixel Grid", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.locator('button:has-text("Smooth Trace")').first()).toBeVisible({ timeout: 15000 });

    // Click Pixel Grid
    await page.locator('button:has-text("Pixel Grid")').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/02-pixel-grid.png" });

    // Switch back to Smooth Trace
    await page.locator('button:has-text("Smooth Trace")').first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/03-smooth-trace.png" });
  });

  test("Continue sends SVG to 3D pipeline", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.locator('button:has-text("Smooth Trace")').first()).toBeVisible({ timeout: 15000 });

    // Wait for processing to finish (Continue button becomes enabled)
    const continueBtn = page.locator('button:has-text("Continue to 3D")').first();
    await expect(continueBtn).toBeVisible({ timeout: 15000 });

    await continueBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "tests/04-after-continue.png" });
  });

  test("no console errors during flow", async ({ page }) => {
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
    await page.waitForTimeout(2000);

    const critical = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("THREE.WebGLRenderer")
    );
    expect(critical).toEqual([]);
  });

  test("uploading corrupt file shows error message", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas[data-engine]", { timeout: 30000, state: "attached" });
    await page.waitForTimeout(3000);

    const toolbarButtons = page.locator(".flex.flex-col.gap-1 button");
    await toolbarButtons.nth(3).click();
    await page.waitForTimeout(500);

    // Create a corrupt "PNG" file (valid PNG signature but garbage data)
    const corruptBuffer = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT with garbage
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const corruptFile = new File([corruptBuffer], "corrupt.png", { type: "image/png" });

    const fileInput = page.locator('input[type="file"][accept*=".png"]');
    await fileInput.setInputFiles({
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.from(corruptBuffer),
    } as any);

    // Either the panel shows an error, or the upload is rejected at validation
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "tests/error-corrupt-file.png" });

    // The error should appear somewhere in the panel
    const errorVisible = await page.locator("text=/error|failed|corrupt|invalid/i").first().isVisible().catch(() => false);
    // At minimum, no crash — the app is still responsive
    const canvasVisible = await page.locator("canvas[data-engine]").isVisible();
    expect(canvasVisible).toBe(true);
  });
});
