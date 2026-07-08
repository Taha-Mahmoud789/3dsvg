import { optimize } from "svgo";

export function optimizeSvg(svg: string): string {
  const result = optimize(svg, {
    multipass: false,
    plugins: [
      "removeDimensions",
      {
        name: "removeAttrs",
        params: { attrs: "(fill|stroke)-opacity" },
      },
    ],
  });
  return result.data;
}

export function calculateSvgSize(svg: string): number {
  return Buffer.byteLength(svg, "utf-8");
}
