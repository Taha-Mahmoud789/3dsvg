declare module "potrace" {
  type TurnPolicy =
    | "black"
    | "white"
    | "left"
    | "right"
    | "minority"
    | "majority";

  interface PotraceOptions {
    turnPolicy?: TurnPolicy;
    turdSize?: number;
    alphaMax?: number;
    optCurve?: boolean;
    optTolerance?: number;
    threshold?: number;
    blackOnWhite?: boolean;
    color?: string;
    background?: string;
  }

  interface PotraceInstance {
    loadImage(
      file: string | Buffer,
      cb: (err: Error | null) => void,
    ): void;
    setParameters(options: PotraceOptions): void;
    getSVG(): string;
  }

  function trace(
    file: string | Buffer,
    options: PotraceOptions,
    cb: (err: Error | null, svg: string, instance?: PotraceInstance) => void,
  ): void;

  function trace(
    file: string | Buffer,
    cb: (err: Error | null, svg: string, instance?: PotraceInstance) => void,
  ): void;

  const Potrace: {
    new (options?: PotraceOptions): PotraceInstance;
    TURNPOLICY_BLACK: "black";
    TURNPOLICY_WHITE: "white";
    TURNPOLICY_LEFT: "left";
    TURNPOLICY_RIGHT: "right";
    TURNPOLICY_MINORITY: "minority";
    TURNPOLICY_MAJORITY: "majority";
    THRESHOLD_AUTO: -1;
    COLOR_AUTO: "auto";
    COLOR_TRANSPARENT: "transparent";
  };

  export { trace, Potrace, PotraceOptions, PotraceInstance, TurnPolicy };
  export default { trace, Potrace };
}
