import { preprocessImage } from "./preprocess";
import { traceBw } from "./trace-bw";
import { traceGrayscale } from "./trace-grayscale";
import { traceColor } from "./trace-color";
import type { ConvertSettings, ConvertResult } from "./types";

export type { ConvertSettings, ConvertResult };

function wrapSvg(innerSvg: string, width: number, height: number): string {
  const paths = innerSvg.match(/<path\b[^>]*>/gi) || [];
  const coloredPaths = paths.map((p) => {
    if (/fill\s*=/.test(p)) return p;
    return p.replace(/<path\b/, '<path fill="black"');
  });

  let result = innerSvg;
  for (let i = 0; i < paths.length; i++) {
    result = result.replace(paths[i], coloredPaths[i]);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/>${result.replace(/<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg>`;
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

  const finalSvg = wrapSvg(rawResult.svg, width, height);
  const sizeBytes = Buffer.byteLength(finalSvg, "utf-8");

  return { svg: finalSvg, sizeBytes };
}
