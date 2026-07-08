import { optimize } from "svgo";

function simplifyPathData(svg: string): string {
  return svg.replace(/d="([^"]+)"/g, (match, d: string) => {
    const simplified = d
      .replace(/(\d+\.\d{3})\d+/g, "$1")
      .replace(/(\d+\.\d)\d+/g, "$1");
    return `d="${simplified}"`;
  });
}

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

  let finalSvg = result.data;
  if (afterPathCount < beforePathCount) {
    finalSvg = svg;
  } else if (afterSize > beforeSize * 1.1) {
    finalSvg = svg;
  }

  finalSvg = simplifyPathData(finalSvg);

  return finalSvg;
}

export function calculateSvgSize(svg: string): number {
  return Buffer.byteLength(svg, "utf-8");
}
