/**
 * =============================================================================
 * 3D Scene
 * =============================================================================
 *
 * Core rendering pipeline. Parses SVG paths via SVGLoader, extrudes them into
 * buffered 3D geometry, and renders the result inside a React Three Fiber
 * <Canvas> with environment lighting, contact shadows, and smooth controls.
 *
 * @packageDocumentation
 */

// Suppress THREE.Clock deprecation warning from R3F internals (fixed when R3F updates to THREE.Timer)
const _origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("THREE.Clock")) return;
  _origWarn.apply(console, args);
};

import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { type MaterialSettings, materialPresets } from "./materials";
import { type MaterialPreset } from "./types";
import {
  SmoothControls,
  IntroAnimation,
  LoopAnimation,
  introComplete,
  type SmoothControlsProps,
  type IntroAnimationProps,
  type AnimationType,
} from "./controls";

// ---------------------------------------------------------------------------
// ExtrudedSVG
// ---------------------------------------------------------------------------

export interface ExtrudedSVGProps {
  svgString: string;
  depth: number;
  smoothness: number;
  color: string;
  colorMap?: Record<number, string> | null;
  materialSettings: MaterialSettings;
  rotationX: number;
  rotationY: number;
  groupRef: React.RefObject<THREE.Group | null>;
  texture?: string;
  textureRepeat?: number;
  textureRotation?: number;
  textureOffset?: [number, number];
  onLoadingChange?: (loading: boolean, progress: number) => void;
}

// ---------------------------------------------------------------------------
function recomputeTriplanarUVs(geo: THREE.BufferGeometry, bb: THREE.Box3) {
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);
  const uvAttr = geo.attributes.uv;
  const posAttr = geo.attributes.position;
  const normalAttr = geo.attributes.normal;
  const maxDimUv = Math.max(bbSize.x, bbSize.y, bbSize.z) || 1;

  for (let j = 0; j < uvAttr.count; j++) {
    const px = posAttr.getX(j);
    const py = posAttr.getY(j);
    const pz = posAttr.getZ(j);
    const nx = Math.abs(normalAttr.getX(j));
    const ny = Math.abs(normalAttr.getY(j));
    const nz = Math.abs(normalAttr.getZ(j));

    let u: number, v: number;
    if (nz >= nx && nz >= ny) {
      u = (px - bb.min.x) / maxDimUv;
      v = 1 - (py - bb.min.y) / maxDimUv;
    } else if (nx >= ny) {
      u = (pz - bb.min.z) / maxDimUv;
      v = 1 - (py - bb.min.y) / maxDimUv;
    } else {
      u = (px - bb.min.x) / maxDimUv;
      v = (pz - bb.min.z) / maxDimUv;
    }
    uvAttr.setXY(j, u, v);
  }
  uvAttr.needsUpdate = true;
}

// useExtrudedGeometry — async geometry computation hook
// Processes shapes in batches to avoid freezing the browser.
// ---------------------------------------------------------------------------

export interface ExtrudedGeometryResult {
  geometries: THREE.BufferGeometry[];
  colors: string[];
  center: THREE.Vector3;
  baseScale: number;
}

const EMPTY_RESULT: ExtrudedGeometryResult = {
  geometries: [],
  colors: [],
  center: new THREE.Vector3(),
  baseScale: 1,
};

// How many shapes to extrude per frame before yielding
const BATCH_SIZE = 20;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SVG_DEFAULT_FILL = "#000000";

function isViewBoxRect(shape: THREE.Shape, vbW: number, vbH: number): boolean {
  const pts = shape.getPoints(4);
  if (pts.length !== 4 && pts.length !== 5) return false;
  const bb = new THREE.Box2();
  for (const p of pts) bb.expandByPoint(p);
  const size = new THREE.Vector2();
  bb.getSize(size);
  const tolerance = 0.01;
  return Math.abs(size.x - vbW) / vbW < tolerance && Math.abs(size.y - vbH) / vbH < tolerance;
}

/**
 * Use the browser's DOMParser to walk the full SVG element tree and resolve
 * all fill/stroke colors via proper CSS inheritance rules. This handles:
 * - fill on parent <g> inherited by child elements
 * - inline style="fill:#hex" overriding attribute fill
 * - <style> block rules (.class selectors, element selectors)
 * - currentColor → fallback to #000000
 * - CSS variables → fallback to computed/inheritable value
 * - fill="none" (stroke-only) handled correctly
 *
 * After resolution, every shape element gets explicit fill/stroke attributes
 * so SVGLoader doesn't need to deal with CSS inheritance at all.
 */
function resolveSVGColors(svgString: string): string {
  // We can only use DOMParser in browser context
  if (typeof DOMParser === "undefined") return svgString;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return svgString;

  // SVG default fill is "black" per spec
  const SVG_DEFAULT_FILL = "#000000";

  // Parse <style> blocks into a stylesheet we can query
  const styleBlocks = doc.querySelectorAll("style");
  const styleRules: { selector: string; props: Record<string, string> }[] = [];
  for (const styleEl of styleBlocks) {
    const css = styleEl.textContent || "";
    // Match .className { prop: val; } and element selectors like path { ... }
    const ruleRe = /([^{]+)\{([^}]+)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(css)) !== null) {
      const selector = rm[1].trim();
      const decls = rm[2];
      const props: Record<string, string> = {};
      const declRe = /([a-z-]+)\s*:\s*([^;]+)/g;
      let dm: RegExpExecArray | null;
      while ((dm = declRe.exec(decls)) !== null) {
        props[dm[1].trim()] = dm[2].trim();
      }
      styleRules.push({ selector, props });
    }
  }

  /** Check if an element matches a CSS selector (simplified but covers common cases) */
  function matchesSelector(el: Element, selector: string): boolean {
    const sel = selector.trim().toLowerCase();
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const classes = el.getAttribute("class")?.split(/\s+/) || [];

    // Handle compound selectors like "g .class" or "path.class"
    if (sel.includes(" ")) {
      // Descendant selector — check if any ancestor matches the parent part
      const parts = sel.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (!matchesSimple(el, lastPart)) return false;
      // Walk up ancestors to find a match for the preceding parts
      const parentSel = parts.slice(0, -1).join(" ");
      let parent = el.parentElement;
      while (parent) {
        if (matchesSelector(parent, parentSel)) return true;
        parent = parent.parentElement;
      }
      return false;
    }

    return matchesSimple(el, sel);
  }

  function matchesSimple(el: Element, sel: string): boolean {
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const classes = el.getAttribute("class")?.split(/\s+/) || [];

    // ".className" — class selector
    if (sel.startsWith(".")) {
      return classes.includes(sel.slice(1));
    }
    // "#id" — ID selector
    if (sel.startsWith("#")) {
      return id === sel.slice(1);
    }
    // "tag.class" — element + class
    if (sel.includes(".")) {
      const [t, c] = sel.split(".", 2);
      return tag === t && classes.includes(c);
    }
    // "tag#id" — element + id
    if (sel.includes("#")) {
      const [t, i] = sel.split("#", 2);
      return tag === t && id === i;
    }
    // "tag" — element selector
    return tag === sel;
  }

  /** Resolve fill for an element by walking up the tree */
  function resolveFill(el: Element): string {
    let current: Element | null = el;

    while (current && current !== svgEl) {
      // Check inline style attribute first (highest priority)
      const inlineStyle = current.getAttribute("style");
      if (inlineStyle) {
        const fillMatch = inlineStyle.match(/(?:^|;\s*)fill\s*:\s*([^;]+)/i);
        if (fillMatch) {
          const val = fillMatch[1].trim();
          if (val !== "inherit" && val !== "unset" && val !== "initial") {
            return normalizeColor(val);
          }
        }
      }

      // Check fill attribute
      const fillAttr = current.getAttribute("fill");
      if (fillAttr && fillAttr !== "inherit" && fillAttr !== "unset" && fillAttr !== "initial") {
        return normalizeColor(fillAttr);
      }

      current = current.parentElement;
    }

    // Check CSS style rules (applied to the element itself)
    for (const rule of styleRules) {
      if (matchesSelector(el, rule.selector)) {
        if ("fill" in rule.props) {
          return normalizeColor(rule.props.fill);
        }
      }
    }

    return SVG_DEFAULT_FILL;
  }

  /** Resolve stroke for an element */
  function resolveStroke(el: Element): string | null {
    let current: Element | null = el;

    while (current && current !== svgEl) {
      const inlineStyle = current.getAttribute("style");
      if (inlineStyle) {
        const strokeMatch = inlineStyle.match(/(?:^|;\s*)stroke\s*:\s*([^;]+)/i);
        if (strokeMatch) {
          const val = strokeMatch[1].trim();
          if (val !== "inherit" && val !== "unset" && val !== "initial" && val !== "none") {
            return normalizeColor(val);
          }
          if (val === "none") return null;
        }
      }

      const strokeAttr = current.getAttribute("stroke");
      if (strokeAttr) {
        if (strokeAttr === "none") return null;
        if (strokeAttr !== "inherit" && strokeAttr !== "unset" && strokeAttr !== "initial") {
          return normalizeColor(strokeAttr);
        }
      }

      current = current.parentElement;
    }

    // Check CSS rules for stroke
    for (const rule of styleRules) {
      if (matchesSelector(el, rule.selector)) {
        if ("stroke" in rule.props) {
          const val = rule.props.stroke;
          if (val === "none") return null;
          return normalizeColor(val);
        }
      }
    }

    return null;
  }

  /** Normalize color values: handle named colors, currentColor, hex, rgb, etc. */
  function normalizeColor(val: string): string {
    const v = val.trim().toLowerCase();
    if (v === "none" || v === "transparent") return "none";
    if (v === "currentColor" || v === "currentcolor") return SVG_DEFAULT_FILL;
    if (v.startsWith("var(")) return SVG_DEFAULT_FILL; // CSS variables — can't resolve
    if (v.startsWith("#")) return v;
    if (v.startsWith("rgb")) return v;
    if (v.startsWith("hsl")) return v;
    // Named colors — return as-is, Three.js Color can parse them
    if (/^[a-z]+$/.test(v)) return val.trim();
    return val.trim();
  }

  // Two-pass approach: first compute all fills/strokes WITHOUT modifying the DOM,
  // then apply them. This prevents a <g> from getting a default fill attribute
  // that would poison child resolution via parent-walk inheritance.
  const shapeTags = ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text", "g"];
  const allElements = [...svgEl.querySelectorAll("*")];
  const resolved: { el: Element; fill: string; stroke: string | null }[] = [];

  // Pass 1: resolve all fills/strokes against the unmodified DOM
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (!shapeTags.includes(tag)) continue;
    resolved.push({ el, fill: resolveFill(el), stroke: resolveStroke(el) });
  }

  // Pass 2: apply resolved values to the DOM
  for (const { el, fill, stroke } of resolved) {
    if (fill && fill !== "none") {
      el.setAttribute("fill", fill);
    } else if (fill === "none") {
      el.setAttribute("fill", "none");
    }

    if (stroke) {
      el.setAttribute("stroke", stroke);
    }

    // Remove fill/stroke from inline style to avoid SVGLoader confusion
    const inlineStyle = el.getAttribute("style");
    if (inlineStyle) {
      const keptProps: string[] = [];
      const parts = inlineStyle.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const prop = trimmed.split(":")[0]?.trim().toLowerCase();
        if (prop && prop !== "fill" && prop !== "stroke" && prop !== "fill-opacity" && prop !== "stroke-opacity") {
          keptProps.push(trimmed);
        }
      }
      if (keptProps.length > 0) {
        el.setAttribute("style", keptProps.join("; "));
      } else {
        el.removeAttribute("style");
      }
    }
  }

  // Remove <style> blocks — we've already inlined everything
  for (const styleEl of styleBlocks) {
    styleEl.remove();
  }

  // Serialize back to string
  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

interface ShapeWithFill {
  shape: THREE.Shape;
  fill: string;
}

function parseShapesFromSVG(svgString: string): ShapeWithFill[] {
  const loader = new SVGLoader();

  // Resolve all CSS colors into inline attributes before SVGLoader parses
  const resolvedSvg = resolveSVGColors(svgString);
  const svgData = loader.parse(resolvedSvg);
  const allShapes: ShapeWithFill[] = [];

  // Parse viewBox for background rect detection
  const vbMatch = svgString.match(/viewBox\s*=\s*["']\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)/);
  const vbW = vbMatch ? parseFloat(vbMatch[3]) : null;
  const vbH = vbMatch ? parseFloat(vbMatch[4]) : null;

  // Detect if SVG uses clipPath elements (design-tool exports like Figma/Illustrator/Elementor)
  const hasClipPaths = /<clipPath\b/.test(svgString);

  if (hasClipPaths) {
    // Extract clipPath definitions
    const clipPathDefs = new Map<string, string>();
    const cpr = /<clipPath\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/clipPath>/gi;
    let cpm: RegExpExecArray | null;
    while ((cpm = cpr.exec(svgString)) !== null) {
      const pm = cpm[2].match(/d="([^"]+)"/);
      if (pm) clipPathDefs.set(cpm[1], pm[1]);
    }

    // Walk the SVG linearly to find <g clip-path> nesting.
    // Only extract the OUTERMOST non-rectangular clip path per group.
    // Nested clip paths use local coordinates that need parent transforms.
    const gEvents: { index: number; isClose: boolean; clipId: string | null }[] = [];
    const openRe = /<g\b[^>]*clip-path="url\(#([^"]+)\)"[^>]*>/gi;
    let om: RegExpExecArray | null;
    while ((om = openRe.exec(svgString)) !== null) {
      gEvents.push({ index: om.index, isClose: false, clipId: om[1] });
    }
    // Count nested <g> openings (without clip-path) to track depth
    const allGOpen = /<g\b[^>]*>/gi;
    const allGClose = /<\/g>/gi;

    // Simpler approach: walk char by char tracking <g> open/close depth
    // and extract the first non-rect clipPath at each depth level
    let depth = 0;
    let shapeClipDepth = -1; // depth at which we last extracted a shape clipPath
    const tagRe = /<(\/?)g\b([^>]*)>|<(\/?)clipPath\b|<\/clipPath>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(svgString)) !== null) {
      const full = tm[0];
      if (full === '</g>') {
        depth--;
        if (depth <= shapeClipDepth) shapeClipDepth = -1;
        continue;
      }
      if (full.startsWith('<g')) {
        depth++;
        const clipMatch = full.match(/clip-path="url\(#([^"]+)\)"/);
        if (clipMatch && shapeClipDepth === -1) {
          const clipId = clipMatch[1];
          const d = clipPathDefs.get(clipId);
          if (d) {
            shapeClipDepth = depth;
            // Extract transform from this g tag
            const txMatch = full.match(/transform="matrix\(([^)]+)\)/);
            let tx = 0, ty = 0;
            if (txMatch) {
              const nums = txMatch[1].split(/[\s,]+/).map(Number);
              if (nums.length >= 6) { tx = nums[4]; ty = nums[5]; }
            }

            try {
              const tsvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
              const tdata = loader.parse(tsvg);
              if (tdata.paths.length > 0) {
                const shapes = SVGLoader.createShapes(tdata.paths[0]);
                // Try to get fill from the resolved SVG (not the original)
                const gRe = new RegExp(`<g[^>]*clip-path="url\\(#${clipId}\\)"[^>]*>`, "i");
                const gMatch = resolvedSvg.match(gRe);
                let clipFill = "#000000";
                if (gMatch) {
                  const gTag = gMatch[0];
                  const fillMatch = gTag.match(/fill="([^"]+)"/);
                  if (fillMatch && fillMatch[1] !== "none" && fillMatch[1] !== "transparent") {
                    clipFill = fillMatch[1];
                  }
                }
                for (const shape of shapes) {
                  if (tx !== 0 || ty !== 0) (shape as THREE.Shape & { translate: (x: number, y: number) => THREE.Shape }).translate(tx, ty);
                  if (vbW && vbH && isViewBoxRect(shape, vbW, vbH)) continue;
                  allShapes.push({ shape, fill: clipFill });
                }
              }
            } catch { /* skip */ }
          }
        }
        continue;
      }
    }
  }

  // Process regular paths (non-clipPath SVGs, or SVGs with mixed content)
  // After resolveSVGColors, path.userData.style.fill should have the correct resolved color
  svgData.paths.forEach((path) => {
    const style = path.userData?.style;
    const fill = style?.fill;
    const stroke = style?.stroke;
    const hasFill = fill && fill !== "none" && fill !== "transparent";
    const hasStroke = stroke && stroke !== "none" && stroke !== "transparent";

    if (hasFill) {
      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        if (vbW && vbH && isViewBoxRect(shape, vbW, vbH)) continue;
        allShapes.push({ shape, fill: fill! });
      }
    }

    if (hasStroke) {
      const strokeWidth = parseFloat(style?.strokeWidth ?? "2");
      const strokeColor = stroke || "#000000";
      const divisions = 12;
      path.subPaths.forEach((subPath) => {
        const points = subPath.getPoints(divisions);
        if (points.length < 2) return;

        const shape = new THREE.Shape();
        const halfWidth = strokeWidth / 2;
        const leftSide: THREE.Vector2[] = [];
        const rightSide: THREE.Vector2[] = [];

        for (let i = 0; i < points.length; i++) {
          const curr = points[i];
          const prev = points[Math.max(0, i - 1)];
          const next = points[Math.min(points.length - 1, i + 1)];
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          leftSide.push(new THREE.Vector2(curr.x + nx * halfWidth, curr.y + ny * halfWidth));
          rightSide.push(new THREE.Vector2(curr.x - nx * halfWidth, curr.y - ny * halfWidth));
        }

        shape.moveTo(leftSide[0].x, leftSide[0].y);
        for (let i = 1; i < leftSide.length; i++) shape.lineTo(leftSide[i].x, leftSide[i].y);
        for (let i = rightSide.length - 1; i >= 0; i--) shape.lineTo(rightSide[i].x, rightSide[i].y);
        shape.closePath();
        allShapes.push({ shape, fill: strokeColor });
      });
    }

    if (!hasFill && !hasStroke) {
      // Path has no visible fill or stroke — still create the shape
      // (it might be a clip path or used for other purposes)
      for (const shape of SVGLoader.createShapes(path)) {
        allShapes.push({ shape, fill: SVG_DEFAULT_FILL });
      }
    }
  });

  return allShapes;
}

export function useExtrudedGeometry(
  svgString: string,
  depth: number,
  smoothness: number
): ExtrudedGeometryResult & { loading: boolean; progress: number; cancel: () => void } {
  const [result, setResult] = useState<ExtrudedGeometryResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);
  const versionRef = useRef(0);
  const prevGeosRef = useRef<THREE.BufferGeometry[]>([]);

  // Dispose old geometries when result changes
  useEffect(() => {
    const oldGeos = prevGeosRef.current;
    prevGeosRef.current = result.geometries;
    return () => { oldGeos.forEach((g) => g.dispose()); };
  }, [result]);

  const cancel = useCallback(() => { cancelRef.current = true; }, []);

  useEffect(() => {
    if (!svgString) {
      setResult(EMPTY_RESULT);
      setLoading(false);
      setProgress(0);
      return;
    }

    const version = ++versionRef.current;
    cancelRef.current = false;
    setLoading(true);
    setProgress(0);

    (async () => {
      // Step 1: Parse shapes with fill colors (fast, synchronous)
      const allShapes = parseShapesFromSVG(svgString);

      if (allShapes.length === 0 || cancelRef.current || version !== versionRef.current) {
        setResult(EMPTY_RESULT);
        setLoading(false);
        return;
      }

      // Step 2: Compute bounding box across all shapes for extrude settings
      const tempGeo = new THREE.ShapeGeometry(allShapes.map((s) => s.shape));
      tempGeo.computeBoundingBox();
      const flatSize = new THREE.Vector3();
      tempGeo.boundingBox!.getSize(flatSize);
      const maxFlatDim = Math.max(flatSize.x, flatSize.y, 1);
      tempGeo.dispose();

      // Reduce quality for complex SVGs to keep it responsive
      const complexity = allShapes.length;
      const qualityScale = complexity > 200 ? 0.2 : complexity > 50 ? 0.4 : complexity > 20 ? 0.7 : 1;

      const scaledDepth = (depth / 10) * maxFlatDim;
      const bevelScale = Math.min(maxFlatDim * 0.02, 1);
      const bevelSegments = Math.max(1, Math.round((2 + smoothness * 12) * qualityScale));
      const curveSegments = Math.max(4, Math.round((12 + smoothness * 40) * qualityScale));
      const bevelThickness = bevelScale * (0.15 + smoothness * 0.2);
      const bevelSize = bevelScale * (0.15 + smoothness * 0.2);

      const extrudeSettings = {
        depth: scaledDepth,
        bevelEnabled: true,
        bevelThickness,
        bevelSize,
        bevelSegments,
        curveSegments,
      };

      // Step 3: Extrude shapes individually (keep separate for per-shape colors)
      const extrudeShapes = async (
        settings: typeof extrudeSettings,
        shapes: ShapeWithFill[],
      ): Promise<{ geos: THREE.ExtrudeGeometry[]; colors: string[] } | null> => {
        const geos: THREE.ExtrudeGeometry[] = [];
        const colors: string[] = [];
        for (let i = 0; i < shapes.length; i++) {
          if (cancelRef.current || version !== versionRef.current) {
            geos.forEach((g) => g.dispose());
            return null;
          }
          geos.push(new THREE.ExtrudeGeometry(shapes[i].shape, settings));
          colors.push(shapes[i].fill);
          if ((i + 1) % BATCH_SIZE === 0) {
            setProgress(Math.round(((i + 1) / shapes.length) * 80));
            await yieldToMain();
          }
        }
        return { geos, colors };
      };

      // Try with full quality first, then retry with lower quality on OOM
      let extrudeResult = await extrudeShapes(extrudeSettings, allShapes);

      if (!extrudeResult && !cancelRef.current && version === versionRef.current) {
        const reducedSettings = {
          ...extrudeSettings,
          curveSegments: Math.max(2, Math.floor(extrudeSettings.curveSegments * 0.3)),
          bevelSegments: Math.max(1, Math.floor(extrudeSettings.bevelSegments * 0.3)),
        };
        setProgress(50);
        await yieldToMain();
        extrudeResult = await extrudeShapes(reducedSettings, allShapes);
      }

      if (!extrudeResult && !cancelRef.current && version === versionRef.current) {
        const minimalSettings = {
          ...extrudeSettings,
          curveSegments: 2,
          bevelSegments: 1,
          bevelEnabled: false,
        };
        setProgress(70);
        await yieldToMain();
        extrudeResult = await extrudeShapes(minimalSettings, allShapes);
      }

      if (!extrudeResult || cancelRef.current || version !== versionRef.current) {
        setResult(EMPTY_RESULT);
        setLoading(false);
        return;
      }

      const { geos, colors } = extrudeResult;

      setProgress(96);
      await yieldToMain();

      // Step 4: Compute overall bounding box and center across all geometries
      const overallBox = new THREE.Box3();
      for (const geo of geos) {
        geo.computeBoundingBox();
        overallBox.union(geo.boundingBox!);
      }

      // Apply UVs to each geometry individually
      for (const geo of geos) {
        recomputeTriplanarUVs(geo, geo.boundingBox!);
        geo.computeVertexNormals();
      }

      const ctr = new THREE.Vector3();
      overallBox.getCenter(ctr);
      const size = new THREE.Vector3();
      overallBox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const s = maxDim > 0 ? 4 / maxDim : 1;

      if (cancelRef.current || version !== versionRef.current) {
        geos.forEach((g) => g.dispose());
        setLoading(false);
        return;
      }

      setProgress(100);
      setResult({ geometries: geos, colors, center: ctr, baseScale: s });
      setLoading(false);
    })();

    return () => { cancelRef.current = true; };
  }, [svgString, depth, smoothness]);

  return { ...result, loading, progress, cancel };
}

export function ExtrudedSVG({
  svgString,
  depth,
  smoothness,
  color,
  colorMap,
  materialSettings,
  rotationX,
  rotationY,
  groupRef,
  texture: textureUrl,
  textureRepeat = 1,
  textureRotation = 0,
  textureOffset = [0, 0],
  onLoadingChange,
}: ExtrudedSVGProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!textureUrl) {
      setTexture(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(textureUrl, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture(tex);
    });
  }, [textureUrl]);

  useEffect(() => {
    if (!texture) return;
    texture.offset.set(textureOffset[0], textureOffset[1]);
    texture.repeat.set(textureRepeat, textureRepeat);
    texture.rotation = textureRotation;
    texture.center.set(0.5, 0.5);
    texture.needsUpdate = true;
  }, [texture, textureRepeat, textureRotation, textureOffset]);

  const { geometries, colors, center, baseScale, loading, progress } = useExtrudedGeometry(svgString, depth, smoothness);

  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
  useEffect(() => {
    onLoadingChangeRef.current?.(loading, progress);
  }, [loading, progress]);

  return (
    <group
      ref={groupRef}
      rotation={[rotationX, rotationY, 0]}
      scale={[baseScale, -baseScale, baseScale]}
    >
      {geometries.map((geometry, i) => {
        const preset = materialPresets[materialSettings.preset];
        const isEmissive = materialSettings.preset === "emissive";
        const wantsTransparency = materialSettings.transparent || materialSettings.opacity < 1;

        // Per-shape color: use SVG fill color, fall back to colorMap, then to the single color prop
        const shapeColor = colors[i] || colorMap?.[i] || color;
        // Material presets affect surface properties only — original SVG colors are never overridden
        const baseColor = texture ? "#ffffff" : shapeColor;
        const emissiveColor = isEmissive ? shapeColor : "#000000";
        const emissiveIntensity = preset.emissiveIntensity ?? 0;
        const transmissionAmount = wantsTransparency ? (1 - materialSettings.opacity) : 0;

        return (
          <mesh
            key={`${i}-${texture ? "tex" : "notex"}-${materialSettings.preset}-${wantsTransparency}`}
            geometry={geometry}
            position={[-center.x, -center.y, -center.z]}
          >
            <meshPhysicalMaterial
              color={baseColor}
              map={texture ?? undefined}
              metalness={materialSettings.metalness}
              roughness={wantsTransparency ? Math.max(0.02, materialSettings.roughness * 0.3) : materialSettings.roughness}
              transmission={transmissionAmount}
              thickness={wantsTransparency ? 2.5 : 0}
              ior={wantsTransparency ? 1.5 : 1.45}
              opacity={1}
              transparent={false}
              wireframe={materialSettings.wireframe}
              emissive={emissiveColor}
              emissiveIntensity={emissiveIntensity}
              clearcoat={wantsTransparency ? 1 : (preset.clearcoat ?? 0)}
              clearcoatRoughness={0.05}
              side={THREE.FrontSide}
              envMapIntensity={0.7}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// ReadyNotifier
// ---------------------------------------------------------------------------

function ReadyNotifier({ onReady }: { onReady?: () => void }) {
  const readyFired = useRef(false);
  const { gl } = useThree();

  // Reveal canvas after first frame is drawn
  useFrame(() => {
    if (!readyFired.current) {
      readyFired.current = true;
      const wrapper = gl.domElement.parentElement;
      if (wrapper) wrapper.style.visibility = "visible";
      onReady?.();
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// SVG3DScene
// ---------------------------------------------------------------------------

export interface SVG3DSceneProps {
  svgString: string;
  depth: number;
  smoothness: number;
  color: string;
  colorMap?: Record<number, string> | null;
  materialSettings: MaterialSettings;
  rotationX: number;
  rotationY: number;
  zoom: number;
  fov: number;
  texture?: string;
  textureRepeat?: number;
  textureRotation?: number;
  textureOffset?: [number, number];
  lightPosition: [number, number, number];
  lightIntensity: number;
  ambientIntensity: number;
  shadow: boolean;
  cursorOrbit: boolean;
  orbitStrength: number;
  draggable: boolean;
  scrollZoom: boolean;
  animate: AnimationType;
  animateSpeed: number;
  animateReverse: boolean;
  intro: "zoom" | "fade" | "none";
  introDuration: number;
  introFrom: { zoom?: number; opacity?: number };
  introTo: { zoom?: number; opacity?: number };
  resetOnIdle: boolean;
  resetDelay: number;
  background: string;
  onReady?: () => void;
  onAnimationComplete?: () => void;
  onLoadingChange?: (loading: boolean, progress: number) => void;
  resetKey?: number;
  registerCanvas?: (canvas: HTMLCanvasElement) => void;
  children?: React.ReactNode;
}

export function SVG3DScene({
  svgString,
  depth,
  smoothness,
  color,
  colorMap,
  materialSettings,
  rotationX,
  rotationY,
  zoom,
  fov,
  texture,
  textureRepeat,
  textureRotation,
  textureOffset,
  lightPosition,
  lightIntensity,
  ambientIntensity,
  shadow,
  cursorOrbit,
  orbitStrength,
  draggable,
  scrollZoom,
  animate,
  animateSpeed,
  animateReverse,
  resetOnIdle,
  resetDelay,
  intro,
  introDuration,
  introFrom,
  introTo,
  background,
  onReady,
  onAnimationComplete,
  onLoadingChange,
  resetKey,
  registerCanvas,
  children,
}: SVG3DSceneProps) {
  const meshGroupRef = useRef<THREE.Group>(null);
  const animGroupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    introComplete.current = false;
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, zoom], fov }}
      dpr={[1, 2]}
      style={{ background, visibility: "hidden" }}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.2,
      }}
      onCreated={({ gl, scene }) => {
        if (background && background !== "transparent") {
          scene.background = new THREE.Color(background);
        }
        const canvas = gl.domElement;
        registerCanvas?.(canvas);
        canvas.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          const wrapper = canvas.parentElement;
          if (wrapper) wrapper.style.visibility = "hidden";
        });
        canvas.addEventListener("webglcontextrestored", () => {
          const wrapper = canvas.parentElement;
          if (wrapper) wrapper.style.visibility = "visible";
        });
      }}
    >
      <ReadyNotifier onReady={onReady} />

      <IntroAnimation
        type={intro}
        duration={introDuration}
        from={introFrom}
        to={introTo}
        onComplete={onAnimationComplete}
      />

      <SmoothControls
        rotationX={rotationX}
        rotationY={rotationY}
        meshRef={meshGroupRef}
        cursorOrbit={cursorOrbit}
        orbitStrength={orbitStrength}
        draggable={draggable}
        scrollZoom={scrollZoom}
        zoom={zoom}
        resetOnIdle={resetOnIdle}
        resetDelay={resetDelay}
        resetKey={resetKey}
      />
      <LoopAnimation type={animate} speed={animateSpeed} reverse={animateReverse} meshRef={animGroupRef} />

      <ambientLight intensity={ambientIntensity} />
      <directionalLight position={lightPosition} intensity={lightIntensity} castShadow />
      <directionalLight position={[-5, 3, -3]} intensity={0.4} />
      <directionalLight position={[0, -4, 6]} intensity={0.2} />
      <pointLight position={[0, 5, 0]} intensity={0.3} />

      <group ref={animGroupRef}>
        <ExtrudedSVG
          svgString={svgString}
          depth={depth}
          smoothness={smoothness}
          color={color}
          colorMap={colorMap}
          materialSettings={materialSettings}
          rotationX={rotationX}
          rotationY={rotationY}
          groupRef={meshGroupRef}
          texture={texture}
          textureRepeat={textureRepeat}
          textureRotation={textureRotation}
          textureOffset={textureOffset}
          onLoadingChange={onLoadingChange}
        />
      </group>

      {shadow && (
        <ContactShadows
          position={[0, -3, 0]}
          opacity={0.4}
          scale={10}
          blur={2}
          far={4}
        />
      )}

      <hemisphereLight args={["#b1e1ff", "#b97a20", 0.5]} />

      <Environment background={false} environmentIntensity={1.0} frames={1} resolution={512}>
        <mesh scale={50}>
          <sphereGeometry args={[1, 64, 64]} />
          <meshBasicMaterial color="#0a0a12" side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 25, 0]}>
          <sphereGeometry args={[20, 64, 64]} />
          <meshBasicMaterial color="#aaaaaa" />
        </mesh>
        <mesh position={[0, 0, 30]}>
          <sphereGeometry args={[15, 64, 64]} />
          <meshBasicMaterial color="#555555" />
        </mesh>
        <mesh position={[-20, 5, 10]}>
          <sphereGeometry args={[10, 64, 64]} />
          <meshBasicMaterial color="#444444" />
        </mesh>
      </Environment>

      {children}
    </Canvas>
  );
}

export default SVG3DScene;
