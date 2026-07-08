/**
 * PNG → SVG Web Worker.
 * Receives image data + settings, returns optimized SVG.
 */

import { quantize, type QuantizeOptions } from "./quantize";
import { traceSmooth, detectGradients, type TraceOptions } from "./trace-smooth";
import { tracePixelGrid, type PixelGridOptions } from "./trace-pixel-grid";
import { optimizeSvg, calculateSvgSize } from "./optimize-svg";

const MAX_TRACE_DIM = 800;

export interface WorkerRequest {
  imageData: ImageData;
  mode: "smooth" | "pixel";
  isApng: boolean;
  options: {
    colorCount: number;
    fullColor: boolean;
    lockedColors: string[];
    colorMode: "full" | "grayscale" | "bw";
    bwThreshold: number;
    smoothing: number;
    speckleSize: number;
    gridResolution: number;
    smoothEdges: boolean;
  };
}

export interface WorkerResponse {
  svg: string;
  sizeBytes: number;
  originalSizeBytes: number;
  mode: "smooth" | "pixel";
  isValid: boolean;
  progress?: number;
}

function downsampleImageData(src: ImageData, maxDim: number): { data: ImageData; scale: number } {
  const { width: w, height: h, data } = src;
  if (w <= maxDim && h <= maxDim) return { data: src, scale: 1 };

  const scale = maxDim / Math.max(w, h);
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);

  // Ponytail: nearest-neighbor downsample, no canvas needed
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let oy = 0; oy < th; oy++) {
    for (let ox = 0; ox < tw; ox++) {
      const sx = Math.floor(ox / scale);
      const sy = Math.floor(oy / scale);
      const si = (sy * w + sx) * 4;
      const di = (oy * tw + ox) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }

  return { data: new ImageData(out, tw, th), scale };
}

function validateSvg(svg: string): boolean {
  try {
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    URL.revokeObjectURL(url);
    return svg.includes("<svg") && svg.includes("</svg>");
  } catch {
    return false;
  }
}

self.onmessage = function (e: MessageEvent<WorkerRequest>) {
  const { imageData, mode, options } = e.data;

  const originalSizeBytes = (imageData.data.length / 4) * 3;

  try {
    // Downsample large images to prevent OOM
    const { data: workData, scale } = downsampleImageData(imageData, MAX_TRACE_DIM);

    // Step 1: Quantize
    const quantizeOpts: QuantizeOptions = {
      colorCount: options.colorCount,
      fullColor: options.fullColor,
      lockedColors: options.lockedColors,
      colorMode: options.colorMode,
      bwThreshold: options.bwThreshold,
    };

    const { palette, indexed, width, height } = quantize(workData, quantizeOpts);

    // Step 2: Trace
    let paths: string;
    let gradientDefs = "";

    if (mode === "smooth") {
      const traceOpts: TraceOptions = {
        colorCount: options.colorCount,
        smoothing: options.smoothing,
        speckleSize: options.speckleSize,
        colorMode: options.colorMode,
        bwThreshold: options.bwThreshold,
        lockedColors: options.lockedColors,
        fullColor: options.fullColor,
      };

      const gradientInfo = detectGradients(workData, indexed, palette, width, height);
      gradientDefs = gradientInfo.defs;

      paths = traceSmooth(indexed, palette, width, height, { ...traceOpts, gradientMeta: gradientInfo.meta });
    } else {
      const pixelOpts: PixelGridOptions = {
        gridResolution: options.gridResolution,
        smoothEdges: options.smoothEdges,
      };
      paths = tracePixelGrid(indexed, palette, width, height, pixelOpts);
    }

    // Step 3: SVG — use downsampled dimensions for coordinates, original for display size
    const origW = imageData.width;
    const origH = imageData.height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${origW}" height="${origH}">${gradientDefs}${paths}</svg>`;

    // Step 4: Optimize
    const optimized = optimizeSvg(svg);
    const sizeBytes = calculateSvgSize(optimized);

    // Step 5: Basic validation
    const isValid = validateSvg(optimized);

    self.postMessage({
      svg: optimized,
      sizeBytes,
      originalSizeBytes,
      mode,
      isValid,
    } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({
      svg: "",
      sizeBytes: 0,
      originalSizeBytes: 0,
      mode,
      isValid: false,
      error: String(err),
    });
  }
};
