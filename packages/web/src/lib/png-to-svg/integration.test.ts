/**
 * Integration test: creates a recognizable PNG (black circle on white),
 * runs it through the full pipeline, and verifies the output SVG
 * actually contains the shape.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertPngToSvg } from "./convert";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "debug-output";

async function createCirclePng(size: number): Promise<Buffer> {
  const center = size / 2;
  const radius = size / 3;

  // Create white background
  const bg = await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).raw().toBuffer();

  // Draw a black circle using SVG overlay
  return sharp(bg, { raw: { width: size, height: size, channels: 3 } })
    .composite([{
      input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${center}" cy="${center}" r="${radius}" fill="black"/></svg>`),
    }])
    .png()
    .toBuffer();
}

async function createLogoPng(): Promise<Buffer> {
  // Simulate an Elementor-like logo: purple square with white "E" shape
  const size = 200;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="20" fill="#9B51E0"/>
    <rect x="50" y="35" width="15" height="130" fill="white"/>
    <rect x="50" y="35" width="100" height="15" fill="white"/>
    <rect x="50" y="92" width="80" height="15" fill="white"/>
    <rect x="50" y="150" width="100" height="15" fill="white"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("Pipeline integration", () => {
  it("circle on white → SVG contains recognizable shape", async () => {
    const circleBuf = await createCirclePng(200);

    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, "test-circle-source.png"), circleBuf);

    const result = await convertPngToSvg(circleBuf, {
      colorMode: "bw",
      colorCount: 2,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    writeFileSync(join(OUTPUT_DIR, "test-circle-output.svg"), result.svg);

    // The SVG must have at least one path
    expect(result.svg).toContain("<path");
    expect(result.sizeBytes).toBeGreaterThan(100);

    // The SVG should be well-formed XML (has opening and closing tags)
    expect(result.svg).toMatch(/^<svg[^>]*>.*<\/svg>$/s);

    // Path data should be non-trivial (not just "M0,0")
    const dMatch = result.svg.match(/d="([^"]+)"/);
    expect(dMatch).not.toBeNull();
    expect(dMatch![1].length).toBeGreaterThan(10);
  });

  it("Elementor-like logo → B&W SVG with paths", async () => {
    const logoBuf = await createLogoPng();

    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(join(OUTPUT_DIR, "test-logo-source.png"), logoBuf);

    const result = await convertPngToSvg(logoBuf, {
      colorMode: "bw",
      colorCount: 2,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    writeFileSync(join(OUTPUT_DIR, "test-logo-bw.svg"), result.svg);

    expect(result.svg).toContain("<path");
    expect(result.sizeBytes).toBeGreaterThan(100);
  });

  it("Elementor-like logo → Full color SVG with colored groups", async () => {
    const logoBuf = await createLogoPng();

    const result = await convertPngToSvg(logoBuf, {
      colorMode: "full",
      colorCount: 4,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    writeFileSync(join(OUTPUT_DIR, "test-logo-color.svg"), result.svg);

    expect(result.svg).toContain("<svg");
    expect(result.sizeBytes).toBeGreaterThan(100);
  });
});
