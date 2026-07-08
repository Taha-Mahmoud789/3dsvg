/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "image-q" {
  interface BuildPaletteOptions {
    colors?: number;
    paletteQuantization?: string;
    colorDistanceFormula?: string;
  }

  interface PointLike {
    r: number;
    g: number;
    b: number;
    a?: number;
  }

  interface PointContainerLike {
    getPointArray(): PointLike[];
  }

  interface PaletteLike {
    getPointContainer(): PointContainerLike;
  }

  export function buildPaletteSync(
    images: any[],
    options?: BuildPaletteOptions,
  ): PaletteLike;
}
