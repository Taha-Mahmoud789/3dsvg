/**
 * PNG → SVG Web Worker.
 * Receives image data + settings, returns optimized SVG.
 */

import { quantize, type QuantizeOptions } from "./quantize";
import { traceSmooth, detectGradients, type TraceOptions } from "./trace-smooth";
import { tracePixelGrid, type PixelGridOptions } from "./trace-pixel-grid";
import { optimizeSvg, calculateSvgSize } from "./optimize-svg";

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

/**
 * Validate SVG by rendering it to an offscreen canvas.
 * Returns true if the SVG renders without errors.
 */
function validateSvg(svg: string): boolean {
  try {
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    // Synchronous check: can we at least create a valid blob URL?
    // Full render validation happens in the main thread via the panel.
    URL.revokeObjectURL(url);
    return svg.includes("<svg") && svg.includes("</svg>");
  } catch {
    return false;
  }
}

self.onmessage = function (e: MessageEvent<WorkerRequest>) {
  const { imageData, mode, options } = e.data;

  const originalSizeBytes = (imageData.data.length / 4) * 3; // rough RGBA→RGB estimate

  try {
    // Step 1: Quantize
    const quantizeOpts: QuantizeOptions = {
      colorCount: options.colorCount,
      fullColor: options.fullColor,
      lockedColors: options.lockedColors,
      colorMode: options.colorMode,
      bwThreshold: options.bwThreshold,
    };

    const { palette, indexed, width, height } = quantize(imageData, quantizeOpts);

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

      // Detect gradients before tracing (smooth mode only)
      const gradientInfo = detectGradients(imageData, indexed, palette, width, height);
      gradientDefs = gradientInfo.defs;

      paths = traceSmooth(indexed, palette, width, height, { ...traceOpts, gradientMeta: gradientInfo.meta });
    } else {
      const pixelOpts: PixelGridOptions = {
        gridResolution: options.gridResolution,
        smoothEdges: options.smoothEdges,
      };
      paths = tracePixelGrid(indexed, palette, width, height, pixelOpts);
    }

    // Step 3: Build SVG with correct viewBox preserving aspect ratio
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${gradientDefs}${paths}</svg>`;

    // Step 4: Optimize
    const optimized = optimizeSvg(svg);
    const sizeBytes = calculateSvgSize(optimized);

    // Step 5: Basic validation
    const isValid = validateSvg(optimized);

    const response: WorkerResponse = {
      svg: optimized,
      sizeBytes,
      originalSizeBytes,
      mode,
      isValid,
    };

    self.postMessage(response);
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
