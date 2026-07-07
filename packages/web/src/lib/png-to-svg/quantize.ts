/**
 * Color quantization using median-cut in CIE Lab perceptual color space.
 * Lab produces perceptually accurate palettes vs raw RGB Euclidean distance.
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export interface QuantizeOptions {
  colorCount: number;
  fullColor: boolean;
  lockedColors: string[];
  colorMode: "full" | "grayscale" | "bw";
  bwThreshold: number;
}

export interface QuantizeResult {
  palette: [number, number, number, number][];
  indexed: Uint8Array;
  width: number;
  height: number;
  isIndexedPng: boolean;
}

// D65 white point
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, v * 255)));
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  // sRGB → linear
  let rc = srgbToLinear(r);
  let gc = srgbToLinear(g);
  let bc = srgbToLinear(b);

  // linear RGB → XYZ (D65)
  let x = (0.4124564 * rc + 0.3575761 * gc + 0.1804375 * bc) / Xn;
  let y = (0.2126729 * rc + 0.7151522 * gc + 0.0721750 * bc) / Yn;
  let z = (0.0193339 * rc + 0.1191920 * gc + 0.9503041 * bc) / Zn;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);

  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const finv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };

  const x = Xn * finv(fx);
  const y = Yn * finv(fy);
  const z = Zn * finv(fz);

  let r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  let g = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  let bv = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bv)];
}

function labDistance(c1: Lab, c2: Lab): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dL * dL + da * da + db * db;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Detect if an ImageData comes from an indexed/paletted PNG
 * by checking if it has very few unique colors (≤ 256).
 */
function detectIndexedPalette(
  data: Uint8ClampedArray
): Map<string, number> | null {
  const colors = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  if (colors.size <= 256) return colors;
  return null;
}

function medianCut(
  pixels: [number, number, number, number][],
  targetCount: number
): [number, number, number, number][] {
  if (pixels.length === 0) return [];
  if (pixels.length <= targetCount) {
    return pixels.map((p) => {
      const sum = p[3] || 1;
      return [
        Math.round(p[0] / sum),
        Math.round(p[1] / sum),
        Math.round(p[2] / sum),
        Math.round(p[3] / sum),
      ] as [number, number, number, number];
    });
  }

  let buckets: [number, number, number, number][][] = [pixels];

  while (buckets.length < targetCount) {
    let maxRange = -1;
    let maxIdx = 0;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255,
          hi = 0;
        for (const p of b) {
          const v = p[ch];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const range = hi - lo;
        if (range > maxRange) {
          maxRange = range;
          maxIdx = i;
        }
      }
    }

    if (maxRange <= 0) break;

    const bucket = buckets[maxIdx];
    let sortCh = 0;
    let bestRange = -1;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 255,
        hi = 0;
      for (const p of bucket) {
        const v = p[ch];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > bestRange) {
        bestRange = hi - lo;
        sortCh = ch;
      }
    }

    bucket.sort((a, b) => a[sortCh] - b[sortCh]);
    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);

    const newBuckets: typeof buckets = [];
    for (let i = 0; i < buckets.length; i++) {
      if (i === maxIdx) {
        if (left.length > 0) newBuckets.push(left);
        if (right.length > 0) newBuckets.push(right);
      } else {
        newBuckets.push(buckets[i]);
      }
    }
    buckets = newBuckets;
  }

  return buckets.map((bucket) => {
    let rSum = 0,
      gSum = 0,
      bSum = 0,
      aSum = 0;
    for (const p of bucket) {
      rSum += p[0];
      gSum += p[1];
      bSum += p[2];
      aSum += p[3];
    }
    const n = bucket.length;
    return [
      Math.round(rSum / n),
      Math.round(gSum / n),
      Math.round(bSum / n),
      Math.round(aSum / n),
    ] as [number, number, number, number];
  });
}

export function quantize(
  imageData: ImageData,
  options: QuantizeOptions
): QuantizeResult {
  const { data, width, height } = imageData;
  const {
    colorCount,
    fullColor,
    lockedColors,
    colorMode,
    bwThreshold,
  } = options;

  const indexed = new Uint8Array(width * height);

  // Check for indexed/paletted PNG
  const existingPalette = detectIndexedPalette(data);

  // Pre-process: apply color mode
  const processed = new Uint8ClampedArray(data.length);
  processed.set(data);

  if (colorMode === "grayscale") {
    for (let i = 0; i < processed.length; i += 4) {
      const gray = Math.round(
        0.299 * processed[i] + 0.587 * processed[i + 1] + 0.114 * processed[i + 2]
      );
      processed[i] = gray;
      processed[i + 1] = gray;
      processed[i + 2] = gray;
    }
  } else if (colorMode === "bw") {
    const threshold = (bwThreshold / 100) * 255;
    for (let i = 0; i < processed.length; i += 4) {
      const gray = 0.299 * processed[i] + 0.587 * processed[i + 1] + 0.114 * processed[i + 2];
      const v = gray >= threshold ? 255 : 0;
      processed[i] = v;
      processed[i + 1] = v;
      processed[i + 2] = v;
    }
  }

  // If full color or already has few colors, skip quantization
  if (fullColor || (existingPalette && existingPalette.size <= colorCount)) {
    const colorMap = new Map<string, number>();
    const palette: [number, number, number, number][] = [];

    if (existingPalette && existingPalette.size <= colorCount) {
      // Use existing palette
      for (const [key] of existingPalette) {
        const [r, g, b] = key.split(",").map(Number);
        colorMap.set(key, palette.length);
        palette.push([r, g, b, 255]);
      }
    } else {
      // Collect unique colors (capped at 256)
      for (let i = 0; i < processed.length; i += 4) {
        if (processed[i + 3] < 128) continue;
        const key = `${processed[i]},${processed[i + 1]},${processed[i + 2]}`;
        if (!colorMap.has(key) && palette.length < 256) {
          colorMap.set(key, palette.length);
          palette.push([processed[i], processed[i + 1], processed[i + 2], processed[i + 3]]);
        }
      }
    }

    for (let i = 0; i < processed.length; i += 4) {
      if (processed[i + 3] < 128) {
        indexed[i / 4] = 0;
        continue;
      }
      const key = `${processed[i]},${processed[i + 1]},${processed[i + 2]}`;
      indexed[i / 4] = colorMap.get(key) ?? 0;
    }

    return { palette, indexed, width, height, isIndexedPng: !!existingPalette };
  }

  // Collect pixels for quantization (skip transparent)
  const pixelBuckets = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < processed.length; i += 4) {
    if (processed[i + 3] < 128) continue;
    const key = `${processed[i]},${processed[i + 1]},${processed[i + 2]}`;
    if (!pixelBuckets.has(key)) {
      pixelBuckets.set(key, [processed[i], processed[i + 1], processed[i + 2], processed[i + 3]]);
    }
  }

  let allPixels = Array.from(pixelBuckets.values());

  // Add locked colors as weight=100x pixels to force them into the palette
  const lockedRgb = lockedColors.map(hexToRgb);
  for (const [r, g, b] of lockedRgb) {
    for (let i = 0; i < 100; i++) {
      allPixels.push([r, g, b, 255]);
    }
  }

  const targetColors = Math.min(colorCount, allPixels.length);
  const palette = medianCut(allPixels, targetColors);

  // Build Lab palette for distance comparison
  const labPalette = palette.map((c) => rgbToLab(c[0], c[1], c[2]));

  // Map locked colors to exact palette entries
  const lockedMap = new Map<number, number>();
  for (const [r, g, b] of lockedRgb) {
    const hex = rgbToHex(r, g, b);
    let bestIdx = 0;
    let bestDist = Infinity;
    const lab = rgbToLab(r, g, b);
    for (let i = 0; i < labPalette.length; i++) {
      const d = labDistance(lab, labPalette[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    lockedMap.set(bestIdx, (lockedMap.get(bestIdx) || 0) + 1);
    // Force exact color
    palette[bestIdx] = [r, g, b, 255];
    labPalette[bestIdx] = lab;
  }

  // Assign each pixel to nearest palette color (Lab distance)
  for (let i = 0; i < processed.length; i += 4) {
    const idx = i / 4;
    if (processed[i + 3] < 128) {
      indexed[idx] = 0;
      continue;
    }
    const pixelLab = rgbToLab(processed[i], processed[i + 1], processed[i + 2]);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < labPalette.length; j++) {
      const d = labDistance(pixelLab, labPalette[j]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    indexed[idx] = bestIdx;
  }

  return {
    palette: palette as [number, number, number, number][],
    indexed,
    width,
    height,
    isIndexedPng: false,
  };
}
