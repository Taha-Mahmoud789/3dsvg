import sharp, { type Sharp } from "sharp";
import type { QualityPreset, ColorMode } from "./types";

export interface PreprocessOptions {
  qualityPreset: QualityPreset;
  colorMode: ColorMode;
}

export interface PreprocessResult {
  buffer: Buffer;
  width: number;
  height: number;
  channels: number;
}

const BALANCED_MAX_DIM = 600;
const HQ_MAX_DIM = 1200;

function computeOtsuThreshold(histogram: number[], totalPixels: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let bestThreshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = t;
    }
  }

  return bestThreshold;
}

async function baseTransform(
  inputBuffer: Buffer,
  maxDim: number,
): Promise<{ pipeline: Sharp; width: number; height: number }> {
  const metadata = await sharp(inputBuffer).metadata();
  const origW = metadata.width ?? 1;
  const origH = metadata.height ?? 1;

  let targetW = origW;
  let targetH = origH;
  if (Math.max(origW, origH) > maxDim) {
    const scale = maxDim / Math.max(origW, origH);
    targetW = Math.round(origW * scale);
    targetH = Math.round(origH * scale);
  }

  const pipeline = sharp(inputBuffer)
    .ensureAlpha()
    .resize(targetW, targetH, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } });

  return { pipeline, width: targetW, height: targetH };
}

export async function preprocessImage(
  inputBuffer: Buffer,
  options: PreprocessOptions,
): Promise<PreprocessResult> {
  const { qualityPreset, colorMode } = options;
  const maxDim = qualityPreset === "high" ? HQ_MAX_DIM : BALANCED_MAX_DIM;

  if (colorMode === "bw") {
    const { pipeline, width, height } = await baseTransform(inputBuffer, maxDim);
    const greyBuf = await pipeline.clone().greyscale().raw().toBuffer();
    const hist = new Array<number>(256).fill(0);
    for (const v of greyBuf) hist[v]++;
    const otsuThresh = computeOtsuThreshold(hist, width * height);

    const result = await pipeline
      .greyscale()
      .threshold(otsuThresh)
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
      channels: result.info.channels,
    };
  }

  if (colorMode === "grayscale") {
    const { pipeline, width, height } = await baseTransform(inputBuffer, maxDim);
    const result = await pipeline.greyscale().raw().toBuffer({ resolveWithObject: true });
    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
      channels: result.info.channels,
    };
  }

  const { pipeline, width, height } = await baseTransform(inputBuffer, maxDim);
  const result = await pipeline.raw().toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}
