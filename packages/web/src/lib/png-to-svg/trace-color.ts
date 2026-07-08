import sharp from "sharp";
import potrace from "potrace";
import { buildPaletteSync } from "image-q";
import { optimizeSvg, calculateSvgSize } from "./optimize";

export interface TraceColorOptions {
  colorCount: number;
  smoothing: number;
  speckleSize: number;
}

export interface TraceColorResult {
  svg: string;
  sizeBytes: number;
}

function smoothingToAlphaMax(smoothing: number): number {
  return (smoothing / 100) * 4;
}

function traceAsync(buffer: Buffer, options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, options, (err: Error | null, svg: string) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
}

function extractPaths(svg: string): string[] {
  const paths: string[] = [];
  const selfClose = /<path\b[^>]*\/>/gi;
  let m = selfClose.exec(svg);
  while (m) {
    paths.push(m[0]);
    m = selfClose.exec(svg);
  }
  const block = /<path\b[^>]*>[\s\S]*?<\/path>/gi;
  let m2 = block.exec(svg);
  while (m2) {
    if (!paths.includes(m2[0])) paths.push(m2[0]);
    m2 = block.exec(svg);
  }
  return paths;
}

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

function euclideanDist(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export async function traceColor(
  preprocessedBuffer: Buffer,
  width: number,
  height: number,
  channels: number,
  options: TraceColorOptions,
): Promise<TraceColorResult> {
  const imageQ = require("image-q");
  const PointContainer = imageQ.utils.PointContainer;

  const pointArray = PointContainer.fromUint8Array(
    new Uint8ClampedArray(preprocessedBuffer),
    width,
    height,
  );

  const palette = buildPaletteSync([pointArray], {
    colors: options.colorCount,
    paletteQuantization: "wuquant",
    colorDistanceFormula: "euclidean-bt709",
  });

  const paletteColors = palette.getPointContainer().getPointArray();
  const hexPalette: string[] = paletteColors.map(
    (p: { r: number; g: number; b: number }) => rgbToHex(p.r, p.g, p.b),
  );

  const alphaMax = smoothingToAlphaMax(options.smoothing);
  const potraceOpts = {
    turdSize: options.speckleSize,
    alphaMax,
    optCurve: true,
    optTolerance: 0.2,
    turnPolicy: "majority" as const,
  };

  const srcPixels = new Uint8ClampedArray(preprocessedBuffer);
  const stride = channels;

  const layerFragments: { svg: string; area: number }[] = [];

  for (const hex of hexPalette) {
    const [tr, tg, tb] = hexToRgb(hex);
    const maskBuffer = Buffer.alloc(width * height);

    for (let i = 0; i < width * height; i++) {
      const offset = i * stride;
      const r = srcPixels[offset];
      const g = srcPixels[offset + 1];
      const b = srcPixels[offset + 2];
      const dist = euclideanDist(r, g, b, tr, tg, tb);
      maskBuffer[i] = dist < 30 ? 0 : 255;
    }

    let pixelCount = 0;
    for (const v of maskBuffer) {
      if (v === 0) pixelCount++;
    }
    if (pixelCount < width * height * 0.001) continue;

    const maskPng = await sharp(maskBuffer, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();

    const layerSvg = await traceAsync(maskPng, potraceOpts);
    const paths = extractPaths(layerSvg);
    if (paths.length === 0) continue;

    const coloredPaths = paths.map((p) => {
      const stripped = p.replace(/\s+fill="[^"]*"/gi, "");
      return stripped.replace(/<path\b/, `<path fill="${hex}"`);
    });

    layerFragments.push({
      svg: coloredPaths.join(""),
      area: pixelCount,
    });
  }

  layerFragments.sort((a, b) => b.area - a.area);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layerFragments.map((l) => l.svg).join("")}</svg>`;
  const optimized = optimizeSvg(svg);
  const sizeBytes = calculateSvgSize(optimized);

  return { svg: optimized, sizeBytes };
}
