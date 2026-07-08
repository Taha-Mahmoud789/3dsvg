/**
 * =============================================================================
 * Types
 * =============================================================================
 *
 * Public type definitions for the 3dsvg engine. SVG3DProps is the single
 * prop interface for the <SVG3D> component — content, shape, material,
 * camera, lighting, animation, and interaction.
 *
 * @packageDocumentation
 */

export type MaterialPreset =
  | "default"
  | "plastic"
  | "metal"
  | "glass"
  | "rubber"
  | "chrome"
  | "gold"
  | "clay"
  | "emissive"
  | "holographic";

export interface SVG3DProps {
  // Content (one of these)
  text?: string;
  font?: string; // Google Font name, defaults to "DM Sans"
  svg?: string; // raw SVG markup or a URL (http://, https://, /, ./)
  /** @deprecated Use `svg` instead */
  svgString?: string;

  // Shape
  depth?: number; // default 1
  smoothness?: number; // default 0.2
  color?: string; // default "#ffffff"
  /**
   * Optional per-shape color map from PNG color sampling.
   * Keys are shape indices (0-based, matching the order SVGLoader produces
   * paths from the SVG), values are hex color strings (e.g. "#ff0000").
   * When provided, each shape gets its own MeshStandardMaterial with the
   * corresponding color instead of sharing the single `color` prop.
   */
  colorMap?: Record<number, string> | null;

  // Material
  material?: MaterialPreset;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  wireframe?: boolean;

  // Camera & Position
  rotationX?: number; // default 0
  rotationY?: number; // default 0
  zoom?: number; // camera Z distance, default 8
  fov?: number; // default 50

  // Interaction
  interactive?: boolean; // shorthand: false disables drag, zoom, and cursor orbit. default true
  cursorOrbit?: boolean; // default true
  orbitStrength?: number; // default 0.15
  draggable?: boolean; // default true
  scrollZoom?: boolean; // default false — when true, scroll over the canvas zooms instead of scrolling the page
  resetOnIdle?: boolean; // smoothly return to default position when user stops interacting. default false
  resetDelay?: number; // seconds of inactivity before resetting. default 2


  // Texture
  texture?: string; // image URL to map onto the 3D surface
  textureRepeat?: number; // how many times the texture tiles, default 1
  textureRotation?: number; // rotation in radians, default 0
  textureOffset?: [number, number]; // UV offset [x, y], default [0, 0]

  // Lighting
  lightPosition?: [number, number, number]; // key light [x, y, z], default [5, 8, 5]
  lightIntensity?: number; // key light brightness, default 1.2
  ambientIntensity?: number; // ambient fill, default 0.3
  shadow?: boolean; // contact shadows, default true

  // Loop Animation
  animate?: "none" | "spin" | "float" | "pulse" | "wobble" | "spinFloat" | "swing"; // default "none"
  animateSpeed?: number; // multiplier, default 1
  animateReverse?: boolean; // reverse direction (spin left, float down-first), default false

  // Intro Animation
  intro?: "zoom" | "fade" | "none"; // default "zoom"
  introDuration?: number; // default 2.5
  introFrom?: { zoom?: number; opacity?: number };
  introTo?: { zoom?: number; opacity?: number };

  // Layout
  width?: string | number; // default "100%"
  height?: string | number; // default "100%"
  background?: string; // default "transparent"
  className?: string;

  // Events
  onReady?: () => void;
  onAnimationComplete?: () => void;
  onLoadingChange?: (loading: boolean, progress: number) => void;
  // Advanced
  resetKey?: number; // increment to force position reset
  registerCanvas?: (canvas: HTMLCanvasElement) => void; // callback with the WebGL canvas element
  children?: React.ReactNode; // extra 3D elements rendered inside the scene
}

export const defaultProps: Required<
  Pick<
    SVG3DProps,
    | "font"
    | "depth"
    | "smoothness"
    | "color"
    | "colorMap"
    | "material"
    | "metalness"
    | "roughness"
    | "opacity"
    | "wireframe"
    | "rotationX"
    | "rotationY"
    | "zoom"
    | "fov"
    | "textureRepeat"
    | "textureRotation"
    | "textureOffset"
    | "lightPosition"
    | "lightIntensity"
    | "ambientIntensity"
    | "shadow"
    | "cursorOrbit"
    | "orbitStrength"
    | "draggable"
    | "scrollZoom"
    | "resetOnIdle"
    | "resetDelay"
    | "intro"
    | "introDuration"
    | "introFrom"
    | "introTo"
    | "width"
    | "height"
    | "background"
  >
> = {
  font: "DM Sans",
  depth: 1,
  smoothness: 0.2,
  color: "#ffffff",
  colorMap: null,
  material: "default",
  metalness: 0.15,
  roughness: 0.35,
  opacity: 1,
  wireframe: false,
  rotationX: 0,
  rotationY: 0,
  zoom: 8,
  fov: 50,
  textureRepeat: 1,
  textureRotation: 0,
  textureOffset: [0, 0] as [number, number],
  lightPosition: [5, 8, 5] as [number, number, number],
  lightIntensity: 1.2,
  ambientIntensity: 0.3,
  shadow: true,
  cursorOrbit: true,
  orbitStrength: 0.15,
  draggable: true,
  scrollZoom: false,
  resetOnIdle: false,
  resetDelay: 2,
  intro: "zoom",
  introDuration: 2.5,
  introFrom: { zoom: 18, opacity: 0 },
  introTo: { zoom: 8, opacity: 1 },
  width: "100%",
  height: "100%",
  background: "transparent",
};
