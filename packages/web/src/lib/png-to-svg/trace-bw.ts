import sharp from "sharp";
import potrace from "potrace";
import { optimizeSvg, calculateSvgSize } from "./optimize";

export interface TraceBwOptions {
  smoothing: number;
  speckleSize: number;
}

export interface TraceBwResult {
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

export async function traceBw(
  preprocessedBuffer: Buffer,
  width: number,
  height: number,
  channels: number,
  options: TraceBwOptions,
): Promise<TraceBwResult> {
  const thresholdBuffer = await sharp(preprocessedBuffer, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .threshold(128)
    .png()
    .toBuffer();

  const svg = await traceAsync(thresholdBuffer, {
    turdSize: options.speckleSize,
    alphaMax: smoothingToAlphaMax(options.smoothing),
    optCurve: true,
    optTolerance: 0.2,
    turnPolicy: "majority",
  });

  const optimized = optimizeSvg(svg);
  const sizeBytes = calculateSvgSize(optimized);

  return { svg: optimized, sizeBytes };
}
