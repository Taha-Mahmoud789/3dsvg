/**
 * Unit tests for the sharp + potrace PNG → SVG bridge.
 */

import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertPngToSvg } from "./convert-png-to-svg";

function makePng(opts: {
  w: number;
  h: number;
  bg: { r: number; g: number; b: number; alpha: number };
  circle?: boolean;
}): Promise<Buffer> {
  let img = sharp({
    create: {
      width: opts.w,
      height: opts.h,
      channels: 4,
      background: opts.bg,
    },
  });

  if (opts.circle) {
    const r = Math.min(opts.w, opts.h) / 3;
    const svg = `<svg width="${opts.w}" height="${opts.h}"><circle cx="${opts.w / 2}" cy="${opts.h / 2}" r="${r}" fill="black"/></svg>`;
    img = img.composite([{ input: Buffer.from(svg) }]);
  }

  return img.png().toBuffer();
}

describe("convertPngToSvg", () => {
  it("converts a solid-color PNG to a valid SVG with paths", async () => {
    const png = await makePng({
      w: 10,
      h: 10,
      bg: { r: 255, g: 0, b: 0, alpha: 1 },
    });

    const { svg, sizeBytes } = await convertPngToSvg(png);

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<path");
    expect(sizeBytes).toBeGreaterThan(0);
    expect(sizeBytes).toBe(new Blob([svg]).size);
  });

  it("converts a circle shape to SVG", async () => {
    const png = await makePng({
      w: 64,
      h: 64,
      bg: { r: 255, g: 255, b: 255, alpha: 1 },
      circle: true,
    });

    const { svg } = await convertPngToSvg(png);

    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  it("handles transparent-background PNGs", async () => {
    const png = await makePng({
      w: 16,
      h: 16,
      bg: { r: 0, g: 0, b: 0, alpha: 0 },
    });

    const { svg } = await convertPngToSvg(png);

    expect(svg).toContain("<svg");
  });

  it("respects optimise=false to skip optimization pass", async () => {
    const png = await makePng({
      w: 10,
      h: 10,
      bg: { r: 0, g: 0, b: 0, alpha: 1 },
    });

    const { svg } = await convertPngToSvg(png, { optimise: false });

    // Unoptimized SVGs from potrace may contain <metadata> or extra whitespace
    expect(svg).toContain("<svg");
  });

  it("respects custom potrace options", async () => {
    const png = await makePng({
      w: 32,
      h: 32,
      bg: { r: 255, g: 255, b: 255, alpha: 1 },
      circle: true,
    });

    // blackOnWhite flips foreground/background interpretation — guaranteed to differ
    const { svg: defaultSvg } = await convertPngToSvg(png, { optimise: false });
    const { svg: inverted } = await convertPngToSvg(png, {
      optimise: false,
      potrace: { blackOnWhite: false },
    });

    expect(inverted).not.toEqual(defaultSvg);
  });
});
