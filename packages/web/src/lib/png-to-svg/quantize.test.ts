import { describe, it, expect } from "vitest";
import { rgbToLab, labToRgb, quantize, type QuantizeOptions } from "./quantize";

describe("rgbToLab", () => {
  it("converts black to L=0", () => {
    const lab = rgbToLab(0, 0, 0);
    expect(lab.L).toBeCloseTo(0, 0);
  });

  it("converts white to L≈100", () => {
    const lab = rgbToLab(255, 255, 255);
    expect(lab.L).toBeCloseTo(100, 0);
  });

  it("pure red has positive a*", () => {
    const lab = rgbToLab(255, 0, 0);
    expect(lab.a).toBeGreaterThan(0);
  });

  it("pure blue has positive b*", () => {
    const lab = rgbToLab(0, 0, 255);
    expect(lab.b).toBeLessThan(0);
  });
});

describe("labToRgb roundtrip", () => {
  it("roundtrips within rounding tolerance", () => {
    const colors: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [128, 128, 128],
      [200, 150, 100],
    ];
    for (const [r, g, b] of colors) {
      const lab = rgbToLab(r, g, b);
      const [r2, g2, b2] = labToRgb(lab.L, lab.a, lab.b);
      expect(Math.abs(r2 - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(g2 - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(b2 - b)).toBeLessThanOrEqual(1);
    }
  });
});

function makeImageData(w: number, h: number, pixels: [number, number, number, number][]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4] = pixels[i][0];
    data[i * 4 + 1] = pixels[i][1];
    data[i * 4 + 2] = pixels[i][2];
    data[i * 4 + 3] = pixels[i][3];
  }
  return { data, width: w, height: h, colorSpace: "srgb" };
}

describe("quantize", () => {
  const defaults: QuantizeOptions = {
    colorCount: 4,
    fullColor: false,
    lockedColors: [],
    colorMode: "full",
    bwThreshold: 50,
  };

  it("preserves full color mode without quantizing", () => {
    const img = makeImageData(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const result = quantize(img, { ...defaults, fullColor: true, colorCount: 1 });
    expect(result.palette.length).toBe(2);
  });

  it("locked colors appear exactly in palette", () => {
    const img = makeImageData(4, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [128, 128, 128, 255],
    ]);
    const locked = "#ff0000";
    const result = quantize(img, { ...defaults, lockedColors: [locked], colorCount: 4 });
    const lockedEntry = result.palette.find(
      ([r, g, b, a]) => r === 255 && g === 0 && b === 0 && a === 255
    );
    expect(lockedEntry).toBeDefined();
  });

  it("grayscale mode produces monochrome palette", () => {
    // Use enough colors to force quantization (more than colorCount)
    const pixels: [number, number, number, number][] = [];
    for (let i = 0; i < 20; i++) {
      pixels.push([i * 12, 255 - i * 12, 100, 255]);
    }
    const img = makeImageData(20, 1, pixels);
    const result = quantize(img, { ...defaults, colorMode: "grayscale", colorCount: 5 });
    for (const [r, g, b] of result.palette) {
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });
});
