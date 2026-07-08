export type ColorMode = "full" | "grayscale" | "bw";
export type QualityPreset = "balanced" | "high";

export interface ConvertSettings {
  colorMode: ColorMode;
  colorCount: number;
  qualityPreset: QualityPreset;
  smoothing: number;
  speckleSize: number;
}

export interface ConvertResult {
  svg: string;
  sizeBytes: number;
}
