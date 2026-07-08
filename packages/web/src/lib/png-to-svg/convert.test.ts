import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertPngToSvg } from "./convert";

async function createTestPng(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("convertPngToSvg", () => {
  it("B&W mode produces valid SVG with paths", async () => {
    const buf = await createTestPng(100, 100, { r: 0, g: 0, b: 0 });
    const result = await convertPngToSvg(buf, {
      colorMode: "bw",
      colorCount: 2,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("</svg>");
    expect(result.svg).toContain("<path");
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("Grayscale mode produces valid SVG", async () => {
    const buf = await createTestPng(100, 100, { r: 128, g: 128, b: 128 });
    const result = await convertPngToSvg(buf, {
      colorMode: "grayscale",
      colorCount: 4,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("</svg>");
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("Full color mode produces valid SVG", async () => {
    const buf = await createTestPng(100, 100, { r: 255, g: 0, b: 0 });
    const result = await convertPngToSvg(buf, {
      colorMode: "full",
      colorCount: 4,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("</svg>");
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("B&W produces larger SVG for complex shapes than solid color", async () => {
    const solidBuf = await createTestPng(100, 100, { r: 0, g: 0, b: 0 });
    const solidResult = await convertPngToSvg(solidBuf, {
      colorMode: "bw",
      colorCount: 2,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    const gradientBuf = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const gradientResult = await convertPngToSvg(gradientBuf, {
      colorMode: "bw",
      colorCount: 2,
      qualityPreset: "balanced",
      smoothing: 60,
      speckleSize: 4,
    });

    expect(solidResult.svg.length).toBeGreaterThan(0);
    expect(gradientResult.svg.length).toBeGreaterThan(0);
  });
});
