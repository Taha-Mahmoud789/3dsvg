import sharp from "sharp";
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

export async function preprocessImage(
  inputBuffer: Buffer,
  options: PreprocessOptions,
): Promise<PreprocessResult> {
  const { qualityPreset, colorMode } = options;
  const maxDim = qualityPreset === "high" ? HQ_MAX_DIM : BALANCED_MAX_DIM;

  let pipeline = sharp(inputBuffer).ensureAlpha();

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

  pipeline = pipeline.resize(targetW, targetH, {
    fit: "inside",
    kernel: sharp.kernel.lanczos3,
  });

  pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });

  if (colorMode === "bw") {
    pipeline = pipeline.toColourspace("b-w");
  } else if (colorMode === "grayscale") {
    pipeline = pipeline.grayscale();
  }

  const result = await pipeline.raw().toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels,
  };
}
