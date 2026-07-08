declare module "potrace" {
  interface PotraceOptions {
    turnPolicy?: "black" | "white" | "left" | "right" | "minority" | "majority";
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optTolerance?: number;
    threshold?: number;
    blackOnWhite?: boolean;
    color?: string;
    background?: string;
  }

  function trace(
    buffer: Buffer,
    options: PotraceOptions,
    callback: (err: Error | null, svg: string) => void
  ): void;
}
