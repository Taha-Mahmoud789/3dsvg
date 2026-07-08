/**
 * PNG → SVG bridge: server-side vectorization using sharp + potrace.
 * Pre-processes a raster buffer into a clean binary mask and pipes the
 * result into potrace for fine SVG path output, then optimises with
 * the shared optimize-svg pass.
 *
 * @packageDocumentation
 */

import sharp from "sharp";
import potrace from "potrace";
import { optimizeSvg, calculateSvgSize } from "./optimize-svg";
import {
  extractColorsAndVectorize,
  type ExtractColorsOptions,
  type MultiColorResult,
} from "./extract-colors";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TurnPolicy =
  | "black"
  | "white"
  | "left"
  | "right"
  | "minority"
  | "majority";

interface PotraceOptions {
  /** Algorithm used to resolve turning decisions. @default "minority" */
  turnPolicy?: TurnPolicy;
  /**
   * Suppress speckles smaller than this area (px²).
   * Lower values preserve finer details. @default 1
   */
  turdSize?: number;
  /** Max allowed deviation from a straight corner. @default 1 */
  alphaMax?: number;
  /** Whether to use curve optimisation. @default true */
  optCurve?: boolean;
  /** Tolerance for curve optimisation (0–1). @default 0.2 */
  optTolerance?: number;
  /** Luminance threshold (0–255 or -1 for auto). @default -1 */
  threshold?: number;
  /** Treat lighter pixels as foreground. @default true */
  blackOnWhite?: boolean;
  /** Stroke/fill colour. @default "auto" */
  color?: string;
  /** Background colour. @default "transparent" */
  background?: string;
}

export interface ConvertPngToSvgOptions {
  /** Potrace tracing parameters. */
  potrace?: PotraceOptions;
  /**
   * Luminance threshold for the binary mask (0–255).
   * Pixels darker than this become foreground (black).
   * @default 128
   */
  threshold?: number;
  /**
   * Whether to run the shared optimize-svg pass on the final output.
   * @default true
   */
  optimise?: boolean;
  /**
   * Coordinate rounding precision (decimal places) when optimise is true.
   * @default 1
   */
  precision?: number;
}

export interface ConvertPngToSvgResult {
  /** The final SVG markup string. */
  svg: string;
  /** Byte length of the SVG. */
  sizeBytes: number;
}

/* ------------------------------------------------------------------ */
/*  Core conversion                                                    */
/* ------------------------------------------------------------------ */

/**
 * Convert a PNG (or any sharp-readable) buffer into a clean, production-ready
 * SVG string via sharp preprocessing → potrace tracing → optimisation.
 *
 * Uses a simple binary threshold (no aggressive contrast linear) so that
 * fine details like thin lines and small shapes are preserved.  The default
 * potrace `turdSize: 1` keeps even the smallest traced regions.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * const buf = await readFile("logo.png");
 * const { svg } = await convertPngToSvg(buf);
 * // svg is now optimised and ready for the <SVG3D> pipeline
 * ```
 */
export async function convertPngToSvg(
  inputPngBuffer: Buffer,
  options: ConvertPngToSvgOptions = {},
): Promise<ConvertPngToSvgResult> {
  const {
    threshold = 128,
    optimise = true,
    precision = 1,
    potrace: potraceOpts = {},
  } = options;

  /* ---- Step 1: sharp pre-processing ----
   * 1. Ensure alpha channel exists (potrace expects a flat bitmap)
   * 2. Convert to greyscale (b-w colourspace) for potrace's luminance model
   * 3. Apply a clean binary threshold at the midpoint.
   *    Unlike the old `.linear(2, -0.5)` approach which crushed anti-aliased
   *    edges and erased fine detail, a simple threshold preserves shapes
   *    down to single-pixel width while still producing a clean BW mask.
   */
  const processedImageBuffer = await sharp(inputPngBuffer)
    .ensureAlpha()
    .toColourspace("b-w")
    .threshold(threshold)
    .toBuffer();

  /* ---- Step 2: potrace tracing ----
   * turdSize: 1 — keep even the tiniest traced regions (was 5 before,
   * which discarded small details like serifs, thin connectors, etc.)
   */
  const svg = await traceAsync(processedImageBuffer, {
    turdSize: 1,
    optTolerance: 0.2,
    turnPolicy: "majority",
    ...potraceOpts,
  });

  /* ---- Step 3: optional optimisation ---- */
  const finalSvg = optimise ? optimizeSvg(svg, precision) : svg;
  const sizeBytes = calculateSvgSize(finalSvg);

  return { svg: finalSvg, sizeBytes };
}

/* ------------------------------------------------------------------ */
/*  Multi-color conversion                                             */
/* ------------------------------------------------------------------ */

/**
 * Convert a PNG buffer into a multi-color SVG, where each dominant color
 * is extracted and vectorized as an independent layer with its exact hex color.
 *
 * This is the server-side companion to `convertPngToSvg` — use it when
 * the downstream consumer (e.g. `<SVG3D>`) needs per-color mesh separation
 * instead of a single-color silhouette.
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * const buf = await readFile("brand-logo.png");
 * const { layers, composite, palette } = await convertPngToMultiColorSvg(buf, {
 *   maxColors: 6,
 *   tolerance: 40,
 * });
 * ```
 */
export async function convertPngToMultiColorSvg(
  inputPngBuffer: Buffer,
  options: ExtractColorsOptions = {},
): Promise<MultiColorResult> {
  return extractColorsAndVectorize(inputPngBuffer, options);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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
