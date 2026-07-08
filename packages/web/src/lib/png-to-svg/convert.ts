import { preprocessImage } from "./preprocess";
import { traceBw } from "./trace-bw";
import { traceGrayscale } from "./trace-grayscale";
import { traceColor } from "./trace-color";
import type { ConvertSettings, ConvertResult } from "./types";

export type { ConvertSettings, ConvertResult };

function ensureFillOnPaths(svg: string): string {
  const pathRegex = /<path\b([^>]*?)(\/?)>/gi;
  return svg.replace(pathRegex, (match, attrs, selfClose) => {
    if (/\bfill\s*=/.test(attrs)) return match;
    return `<path${attrs} fill="black"${selfClose}>`;
  });
}

function wrapWithBackground(innerSvg: string, width: number, height: number): string {
  const body = innerSvg
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/>${body}</svg>`;
}

export async function convertPngToSvg(
  inputBuffer: Buffer,
  settings: ConvertSettings,
): Promise<ConvertResult> {
  const { colorMode, colorCount, qualityPreset, smoothing, speckleSize } = settings;

  const preprocessed = await preprocessImage(inputBuffer, {
    qualityPreset,
    colorMode,
  });

  const { buffer, width, height, channels } = preprocessed;

  let rawResult: { svg: string; sizeBytes: number };

  switch (colorMode) {
    case "bw": {
      rawResult = await traceBw(buffer, width, height, channels, {
        smoothing,
        speckleSize,
      });
      break;
    }

    case "grayscale": {
      const graySteps = colorCount <= 4 ? 4 : colorCount <= 8 ? 6 : 10;
      rawResult = await traceGrayscale(buffer, width, height, channels, {
        smoothing,
        speckleSize,
        graySteps,
      });
      break;
    }

    case "full":
    default: {
      rawResult = await traceColor(buffer, width, height, channels, {
        colorCount,
        smoothing,
        speckleSize,
      });
      break;
    }
  }

  const withFill = ensureFillOnPaths(rawResult.svg);
  const finalSvg = wrapWithBackground(withFill, width, height);
  const sizeBytes = Buffer.byteLength(finalSvg, "utf-8");

  return { svg: finalSvg, sizeBytes };
}
