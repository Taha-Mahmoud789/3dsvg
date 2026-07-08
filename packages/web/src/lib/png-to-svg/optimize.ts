import { optimize } from "svgo";

export function optimizeSvg(svg: string): string {
  const beforePathCount = (svg.match(/<path\b/g) || []).length;
  const beforeSize = Buffer.byteLength(svg, "utf-8");

  const result = optimize(svg, {
    multipass: false,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            convertPathData: false,
            convertTransform: false,
            collapseGroups: false,
            mergePaths: false,
            moveElemsAttrsToGroup: false,
            moveGroupAttrsToElems: false,
            inlineStyles: false,
            convertShapeToPath: false,
            convertEllipseToCircle: false,
            removeUselessStrokeAndFill: false,
            cleanupNumericValues: false,
            convertColors: false,
            removeHiddenElems: false,
            removeEmptyContainers: false,
            removeUnknownsAndDefaults: false,
          },
        },
      },
      "removeDimensions",
    ],
  });

  const afterPathCount = (result.data.match(/<path\b/g) || []).length;
  const afterSize = Buffer.byteLength(result.data, "utf-8");

  if (afterPathCount < beforePathCount) {
    console.warn(
      `SVGO stripped paths: ${beforePathCount} → ${afterPathCount}. Using raw SVG.`,
    );
    return svg;
  }

  if (afterSize > beforeSize * 1.1) {
    return svg;
  }

  return result.data;
}

export function calculateSvgSize(svg: string): number {
  return Buffer.byteLength(svg, "utf-8");
}
