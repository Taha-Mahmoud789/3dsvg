import sharp from "sharp";
import potrace from "potrace";
import { optimizeSvg, calculateSvgSize } from "./optimize";

export interface TraceGrayscaleOptions {
  smoothing: number;
  speckleSize: number;
  graySteps?: number;
}

export interface TraceGrayscaleResult {
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

function grayHex(level: number, total: number): string {
  const v = Math.round((level / (total - 1)) * 255);
  const hex = v.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

export async function traceGrayscale(
  preprocessedBuffer: Buffer,
  width: number,
  height: number,
  channels: number,
  options: TraceGrayscaleOptions,
): Promise<TraceGrayscaleResult> {
  const graySteps = options.graySteps ?? 6;
  const alphaMax = smoothingToAlphaMax(options.smoothing);

  const potraceOpts = {
    turdSize: options.speckleSize,
    alphaMax,
    optCurve: true,
    optTolerance: 0.2,
    threshold: 128,
    blackOnWhite: true,
    turnPolicy: "majority" as const,
  };

  const thresholds: number[] = [];
  for (let i = 1; i < graySteps; i++) {
    thresholds.push(Math.round((i / graySteps) * 255));
  }

  const layerFragments: string[] = [];

  for (let i = 0; i < thresholds.length; i++) {
    const thresh = thresholds[i];
    const maskBuffer = await sharp(preprocessedBuffer, {
      raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
    })
      .threshold(thresh)
      .png()
      .toBuffer();

    const layerSvg = await traceAsync(maskBuffer, potraceOpts);
    const paths = extractPaths(layerSvg);
    if (paths.length === 0) continue;

    const fillColor = grayHex(i, graySteps);
    const coloredPaths = paths.map((p) => {
      const stripped = p.replace(/\s+fill="[^"]*"/gi, "");
      return stripped.replace(/<path\b/, `<path fill="${fillColor}"`);
    });
    layerFragments.push(coloredPaths.join(""));
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${layerFragments.join("")}</svg>`;
  const optimized = optimizeSvg(svg);
  const sizeBytes = calculateSvgSize(optimized);

  return { svg: optimized, sizeBytes };
}
