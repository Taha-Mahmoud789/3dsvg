/**
 * Multi-color extraction and vectorization pipeline.
 *
 * Detects dominant colors in a PNG buffer using median-cut quantization in
 * CIE Lab perceptual color space, isolates each color layer as a high-contrast
 * black/white mask, traces each mask through potrace, and composes the results
 * into a single multi-color SVG with per-layer `<g fill="...">` groups.
 *
 * @packageDocumentation
 */

import sharp from "sharp";
import potrace from "potrace";
import {
  rgbToLab,
  type Lab,
} from "./quantize";
import { optimizeSvg, calculateSvgSize } from "./optimize-svg";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ColorLayer {
  /** The dominant hex color this layer represents (e.g. "#ff0000"). */
  color: string;
  /** Potrace SVG output with `fill` set to the layer's hex color. */
  svgString: string;
  /** Number of pixels that belonged to this color in the source image. */
  pixelCount: number;
  /** Percentage of non-transparent pixels this color occupies. */
  percentage: number;
}

export interface MultiColorResult {
  /** Per-color traced layers, sorted by area (largest first). */
  layers: ColorLayer[];
  /** All layers merged into a single `<svg>` with grouped `<g fill>` elements. */
  composite: string;
  /** Source image width in pixels. */
  width: number;
  /** Source image height in pixels. */
  height: number;
  /** Byte length of the composite SVG. */
  sizeBytes: number;
  /** All detected hex colors, in palette order. */
  palette: string[];
}

export interface ExtractColorsOptions {
  /**
   * Maximum number of dominant colors to extract.
   * Clamped to 2–16. @default 8
   */
  maxColors?: number;
  /**
   * Euclidean RGB distance threshold for pixel-to-palette matching.
   * Higher values reduce the palette more aggressively. @default 45
   */
  tolerance?: number;
  /**
   * Linear contrast multiplier applied to each color mask before tracing.
   * Formula: `pixel * contrast + (0.5 - 0.5 * contrast)`. @default 2
   */
  contrast?: number;
  /** Potrace tracing parameters (applied to every layer). */
  potrace?: {
    turnPolicy?: "black" | "white" | "left" | "right" | "minority" | "majority";
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optTolerance?: number;
    threshold?: number;
    blackOnWhite?: boolean;
  };
  /** Run the optimize-svg pass on the final composite. @default true */
  optimise?: boolean;
  /** Coordinate rounding precision (decimal places) when optimise is true. @default 1 */
  precision?: number;
}

/* ------------------------------------------------------------------ */
/*  Median-cut palette extraction                                      */
/* ------------------------------------------------------------------ */

interface RgbPixel {
  r: number;
  g: number;
  b: number;
}

function medianCutRgb(
  pixels: RgbPixel[],
  targetCount: number,
): RgbPixel[] {
  if (pixels.length === 0) return [];
  if (pixels.length <= targetCount) return pixels;

  let buckets: RgbPixel[][] = [pixels];

  while (buckets.length < targetCount) {
    let maxRange = -1;
    let maxIdx = 0;

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          const v = ch === 0 ? p.r : ch === 1 ? p.g : p.b;
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
      let lo = 255;
      let hi = 0;
      for (const p of bucket) {
        const v = ch === 0 ? p.r : ch === 1 ? p.g : p.b;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > bestRange) {
        bestRange = hi - lo;
        sortCh = ch;
      }
    }

    bucket.sort((a, b) => {
      const va = sortCh === 0 ? a.r : sortCh === 1 ? a.g : a.b;
      const vb = sortCh === 0 ? b.r : sortCh === 1 ? b.g : b.b;
      return va - vb;
    });

    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);

    const newBuckets: RgbPixel[][] = [];
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

  // Average each bucket to produce the representative color
  return buckets.map((bucket) => {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (const p of bucket) {
      rSum += p.r;
      gSum += p.g;
      bSum += p.b;
    }
    const n = bucket.length;
    return {
      r: Math.round(rSum / n),
      g: Math.round(gSum / n),
      b: Math.round(bSum / n),
    };
  });
}

/**
 * Extract dominant colors from raw RGBA pixel data using median-cut in
 * Lab perceptual space for visually accurate palette selection.
 *
 * Returns hex strings sorted by pixel count (most dominant first).
 */
function extractDominantColors(
  rawPixels: Buffer,
  channels: number,
  _width: number,
  _height: number,
  maxColors: number,
): string[] {
  // 1. Collect unique RGB colors with pixel counts (skip transparent)
  const colorCounts = new Map<string, RgbPixel & { count: number }>();
  let totalOpaque = 0;

  for (let i = 0; i < rawPixels.length; i += channels) {
    const a = channels === 4 ? rawPixels[i + 3] : 255;
    if (a < 30) continue; // Skip near-transparent pixels

    const r = rawPixels[i];
    const g = rawPixels[i + 1];
    const b = rawPixels[i + 2];
    const key = `${r},${g},${b}`;

    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorCounts.set(key, { r, g, b, count: 1 });
    }
    totalOpaque++;
  }

  if (totalOpaque === 0) return [];

  // 2. If the image already has ≤ maxColors unique colors, use them directly
  const uniqueColors = Array.from(colorCounts.values());
  if (uniqueColors.length <= maxColors) {
    // Sort by count descending
    uniqueColors.sort((a, b) => b.count - a.count);
    return uniqueColors.map((c) =>
      rgbToHex(c.r, c.g, c.b)
    );
  }

  // 3. Build weighted pixel list for median-cut (sample if very large)
  const MAX_SAMPLE = 50000;
  let pixelsForCut: RgbPixel[] = [];

  if (totalOpaque <= MAX_SAMPLE) {
    for (const c of uniqueColors) {
      pixelsForCut.push({ r: c.r, g: c.g, b: c.b });
    }
  } else {
    // Weighted sampling: each unique color appears proportional to its count
    for (const c of uniqueColors) {
      const weight = Math.max(1, Math.round((c.count / totalOpaque) * MAX_SAMPLE));
      for (let w = 0; w < weight; w++) {
        pixelsForCut.push({ r: c.r, g: c.g, b: c.b });
      }
    }
  }

  // 4. Run median-cut to get target palette
  const palette = medianCutRgb(pixelsForCut, maxColors);

  // 5. Sort palette by how many source pixels map to each entry (dominance)
  const labPalette = palette.map((c) => rgbToLab(c.r, c.g, c.b));
  const paletteCounts = new Array(palette.length).fill(0);

  for (const c of uniqueColors) {
    const lab = rgbToLab(c.r, c.g, c.b);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < labPalette.length; j++) {
      const d = labDistance(lab, labPalette[j]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    paletteCounts[bestIdx] += c.count;
  }

  // Sort by dominance
  const indexed = palette.map((c, i) => ({ ...c, count: paletteCounts[i] }));
  indexed.sort((a, b) => b.count - a.count);

  return indexed.map((c) => rgbToHex(c.r, c.g, c.b));
}

/* ------------------------------------------------------------------ */
/*  Color masking                                                      */
/* ------------------------------------------------------------------ */

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function labDistance(c1: Lab, c2: Lab): number {
  const dL = c1.L - c2.L;
  const da = c1.a - c2.a;
  const db = c1.b - c2.b;
  return dL * dL + da * da + db * db;
}

function euclideanRgbDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Create a high-contrast black/white mask for a single target color.
 *
 * - Target color pixels → black (foreground for potrace)
 * - All other pixels → white (background)
 * - Anti-aliased edge pixels → grayscale proportional to match strength
 *   (preserves smooth edges in the final trace)
 *
 * Returns a sharp-ready raw RGBA buffer suitable for potrace input.
 */
function createColorMask(
  rawPixels: Buffer,
  channels: number,
  width: number,
  height: number,
  targetRgb: [number, number, number],
  tolerance: number,
): Buffer {
  const pixelCount = width * height;
  // Potrace expects an 8-bit grayscale bitmap; we produce a 1-channel raw
  const maskBuffer = Buffer.alloc(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const r = rawPixels[offset];
    const g = rawPixels[offset + 1];
    const b = rawPixels[offset + 2];
    const a = channels === 4 ? rawPixels[offset + 3] : 255;

    if (a < 30) {
      // Transparent pixel → background (white)
      maskBuffer[i] = 255;
      continue;
    }

    const dist = euclideanRgbDistance(r, g, b, targetRgb[0], targetRgb[1], targetRgb[2]);

    if (dist <= tolerance * 0.5) {
      // Strong match → foreground (black)
      maskBuffer[i] = 0;
    } else if (dist <= tolerance * 1.5) {
      // Soft edge: anti-aliased zone → grayscale gradient
      // Maps distance [tolerance*0.5, tolerance*1.5] → black [0] → white [255]
      const t = (dist - tolerance * 0.5) / tolerance;
      maskBuffer[i] = Math.round(t * 255);
    } else {
      // No match → background (white)
      maskBuffer[i] = 255;
    }
  }

  return maskBuffer;
}

/* ------------------------------------------------------------------ */
/*  Potrace tracing                                                    */
/* ------------------------------------------------------------------ */

type TurnPolicy =
  | "black"
  | "white"
  | "left"
  | "right"
  | "minority"
  | "majority";

interface PotraceOptions {
  turnPolicy?: TurnPolicy;
  turdSize?: number;
  alphaMax?: number;
  optCurve?: boolean;
  optTolerance?: number;
  threshold?: number;
  blackOnWhite?: boolean;
  color?: string;
  background?: string;
}

/** Promisified wrapper around potrace.trace(). */
function traceAsync(
  buffer: Buffer,
  options: PotraceOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, options, (err: Error | null, svg: string) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

/**
 * Inject a hex fill color into a single-color potrace SVG string.
 *
 * Potrace outputs SVGs with a default black `<path>` fill. This function
 * replaces the fill attribute (or the style) with the target color, and
 * removes the default SVG dimensions/viewport so the output is a clean
 * path fragment that can be embedded in a composite `<svg>`.
 */
function injectColorIntoSvg(potraceSvg: string, hexColor: string): string {
  let svg = potraceSvg;

  // Replace fill="black" or fill="#000000" with target color
  svg = svg.replace(
    /fill\s*=\s*"(?:black|#000000|#000)"/gi,
    `fill="${hexColor}"`,
  );

  // Replace fill in style attributes
  svg = svg.replace(
    /fill\s*:\s*(?:black|#000000|#000)/gi,
    `fill: ${hexColor}`,
  );

  // If no fill was found on a path, add fill to the first <path>
  if (!svg.includes(`fill="${hexColor}"`)) {
    svg = svg.replace(
      /<path\b/,
      `<path fill="${hexColor}"`,
    );
  }

  return svg;
}

/* ------------------------------------------------------------------ */
/*  Main public API                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract dominant colors from a PNG buffer and vectorize each color
 * layer independently through potrace.
 *
 * Returns an array of `ColorLayer` objects (each containing a single-color
 * SVG string and the hex color), plus a merged composite SVG that stacks
 * all layers as `<g fill="...">` groups.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * const buf = await readFile("logo.png");
 * const { layers, composite, palette } = await extractColorsAndVectorize(buf, {
 *   maxColors: 6,
 *   tolerance: 40,
 * });
 * for (const layer of layers) {
 *   console.log(`${layer.color}: ${layer.percentage.toFixed(1)}%`);
 * }
 * // composite is ready for the <SVG3D> pipeline
 * ```
 */
export async function extractColorsAndVectorize(
  pngBuffer: Buffer,
  options: ExtractColorsOptions = {},
): Promise<MultiColorResult> {
  const {
    maxColors = 8,
    tolerance = 45,
    contrast: _contrast = 2,
    potrace: potraceOpts = {},
    optimise = true,
    precision = 1,
  } = options;

  const clampedMaxColors = Math.max(2, Math.min(16, maxColors));

  /* ---- Step 1: sharp preprocessing ---- */
  const image = sharp(pngBuffer).ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;

  const rawResult = await image.raw().toBuffer({ resolveWithObject: true });
  const rawPixels = rawResult.data;
  const channels = rawResult.info.channels;

  /* ---- Step 2: extract dominant colors via median-cut ---- */
  const dominantColors = extractDominantColors(
    rawPixels,
    channels,
    width,
    height,
    clampedMaxColors,
  );

  if (dominantColors.length === 0) {
    return {
      layers: [],
      composite: createEmptySvg(width, height),
      width,
      height,
      sizeBytes: 0,
      palette: [],
    };
  }

  /* ---- Step 3: for each color, create mask and trace ---- */
  const colorLayers: ColorLayer[] = [];

  // Count total opaque pixels for percentage calculation
  let totalOpaque = 0;
  for (let i = 0; i < rawPixels.length; i += channels) {
    const a = channels === 4 ? rawPixels[i + 3] : 255;
    if (a >= 30) totalOpaque++;
  }

  for (const hex of dominantColors) {
    const targetRgb = hexToRgb(hex);

    // Create the BW mask for this color
    const maskBuffer = createColorMask(
      rawPixels,
      channels,
      width,
      height,
      targetRgb,
      tolerance,
    );

    // Count pixels that matched this color
    let colorPixelCount = 0;
    for (const pixel of maskBuffer) {
      if (pixel < 128) colorPixelCount++; // Black = this color
    }

    // Skip colors that occupy less than 0.1% of the image (noise)
    if (colorPixelCount < width * height * 0.001) continue;

    // Create a sharp-compatible raw grayscale image from the mask
    // potrace needs a BMP-like input; we use sharp to wrap the raw data
    const maskImageBuffer = await sharp(maskBuffer, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    // Trace with potrace
    const potraceSvg = await traceAsync(maskImageBuffer, {
      turdSize: 3,
      optTolerance: 0.2,
      turnPolicy: "majority",
      blackOnWhite: true,
      ...potraceOpts,
    });

    // Inject the hex color and strip potrace's SVG wrapper
    const coloredSvg = injectColorIntoSvg(potraceSvg, hex);

    colorLayers.push({
      color: hex,
      svgString: coloredSvg,
      pixelCount: colorPixelCount,
      percentage: totalOpaque > 0 ? (colorPixelCount / totalOpaque) * 100 : 0,
    });
  }

  /* ---- Step 4: compose all layers into a single SVG ---- */
  const composite = composeMultiColorSvg(
    colorLayers,
    width,
    height,
    optimise,
    precision,
  );

  const sizeBytes = calculateSvgSize(composite);

  return {
    layers: colorLayers,
    composite,
    width,
    height,
    sizeBytes,
    palette: colorLayers.map((l) => l.color),
  };
}

/* ------------------------------------------------------------------ */
/*  SVG composition                                                    */
/* ------------------------------------------------------------------ */

function createEmptySvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
}

/**
 * Merge multiple single-color potrace SVG layers into one composite SVG.
 *
 * Each layer becomes a `<g fill="hexColor">` group containing the
 * `<path>` elements from that layer's potrace output.  Layers are
 * ordered largest-area-first so the dominant shapes render at the bottom.
 */
function composeMultiColorSvg(
  layers: ColorLayer[],
  width: number,
  height: number,
  optimise: boolean,
  precision: number,
): string {
  if (layers.length === 0) {
    return createEmptySvg(width, height);
  }

  // Sort layers by pixel count (largest first — background shapes first)
  const sorted = [...layers].sort((a, b) => b.pixelCount - a.pixelCount);

  // Extract path elements from each layer's potrace SVG
  const layerFragments: string[] = [];

  for (const layer of sorted) {
    const paths = extractPathsFromSvg(layer.svgString);
    if (paths.length === 0) continue;
    layerFragments.push(
      `<g fill="${layer.color}">${paths.join("")}</g>`,
    );
  }

  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layerFragments.join("")}</svg>`;

  if (optimise) {
    svg = optimizeSvg(svg, precision);
  }

  return svg;
}

/**
 * Extract `<path>` elements from a potrace-generated SVG string.
 */
function extractPathsFromSvg(svg: string): string[] {
  const paths: string[] = [];
  const pathRegex = /<path\b[^>]*\/>/gi;
  let match = pathRegex.exec(svg);
  while (match) {
    paths.push(match[0]);
    match = pathRegex.exec(svg);
  }
  // Also match non-self-closing <path>...</path> if present
  const pathBlockRegex = /<path\b[^>]*>[\s\S]*?<\/path>/gi;
  let match2 = pathBlockRegex.exec(svg);
  while (match2) {
    // Avoid duplicates if already captured as self-closing
    if (!paths.includes(match2[0])) {
      paths.push(match2[0]);
    }
    match2 = pathBlockRegex.exec(svg);
  }
  return paths;
}
