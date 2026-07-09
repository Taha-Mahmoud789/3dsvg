/**
 * Regression test: view-dependent specular noise on white/light surfaces.
 *
 * Fixture: test-assets/html5-original-wordmark.svg
 *   — orange HTML5 shield with a white "5" numeral
 *   — the white "5" area historically exhibited shimmering/static noise
 *     when the camera was orbited, caused by low-res PMREM environment map
 *
 * Named fixture: "html5-wordmark-regression"
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SVG_FIXTURE_PATH = resolve(__dirname, "../../../test-assets/html5-original-wordmark.svg");
const SVG_FIXTURE_NAME = "html5-wordmark-regression";

async function orbitCamera(page: import("@playwright/test").Page, dx: number, dy: number) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

test(`3D regression: ${SVG_FIXTURE_NAME}`, async ({ page }) => {
  const svgContent = readFileSync(SVG_FIXTURE_PATH, "utf-8");

  await page.goto("/");
  await page.waitForTimeout(2000);

  // Click code icon (3rd button in left sidebar, ~y=115)
  await page.mouse.click(42, 115);
  await page.waitForTimeout(1500);

  // Paste fixture SVG
  const ta = page.locator("textarea:visible").first();
  await ta.fill(svgContent);
  await page.waitForTimeout(5000);

  // Screenshot 1: Front view
  await page.screenshot({ path: `qa-screenshots/${SVG_FIXTURE_NAME}-front.png` });

  // Screenshot 2: Angled right-up
  await orbitCamera(page, 200, -120);
  await page.screenshot({ path: `qa-screenshots/${SVG_FIXTURE_NAME}-right-up.png` });

  // Screenshot 3: Angled left-down
  await orbitCamera(page, -300, 240);
  await page.screenshot({ path: `qa-screenshots/${SVG_FIXTURE_NAME}-left-down.png` });

  // Screenshot 4: Grazing angle
  await orbitCamera(page, 150, 200);
  await page.screenshot({ path: `qa-screenshots/${SVG_FIXTURE_NAME}-grazing.png` });

  console.log(`${SVG_FIXTURE_NAME}: 4 screenshots captured (front / right-up / left-down / grazing)`);
});
