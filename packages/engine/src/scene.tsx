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
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  center: THREE.Vector3;
  baseScale: number;
}

const EMPTY_RESULT: ExtrudedGeometryResult = {
  geometries: [],
  center: new THREE.Vector3(),
  baseScale: 1,
};

// How many shapes to extrude per frame before yielding
const BATCH_SIZE = 20;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

function parseShapesFromSVG(svgString: string): THREE.Shape[] {
  const loader = new SVGLoader();
  const svgData = loader.parse(svgString);
  const allShapes: THREE.Shape[] = [];

  // Parse viewBox for background rect detection
  const vbMatch = svgString.match(/viewBox\s*=\s*["']\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)/);
  const vbW = vbMatch ? parseFloat(vbMatch[3]) : null;
  const vbH = vbMatch ? parseFloat(vbMatch[4]) : null;

  svgData.paths.forEach((path) => {
    const style = path.userData?.style;
    const hasFill = style?.fill && style.fill !== "none" && style.fill !== "transparent";
    const hasStroke = style?.stroke && style.stroke !== "none" && style.stroke !== "transparent";

    if (hasFill) {
      const shapes = SVGLoader.createShapes(path);
      for (const shape of shapes) {
        // Skip full-viewBox rectangles (background artifacts from export tools)
        if (vbW && vbH && isViewBoxRect(shape, vbW, vbH)) continue;
        allShapes.push(shape);
      }
    }

    if (hasStroke) {
      const strokeWidth = parseFloat(style?.strokeWidth ?? "2");
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
        allShapes.push(shape);
      });
    }

    if (!hasFill && !hasStroke) {
      allShapes.push(...SVGLoader.createShapes(path));
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
      // Step 1: Parse shapes (fast, synchronous)
      const allShapes = parseShapesFromSVG(svgString);

      if (allShapes.length === 0 || cancelRef.current || version !== versionRef.current) {
        setResult(EMPTY_RESULT);
        setLoading(false);
        return;
      }

      // Step 2: Compute extrude settings
      const tempGeo = new THREE.ShapeGeometry(allShapes);
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

      // Step 3: Extrude shapes in batches, yielding between each
      let individualGeos: THREE.ExtrudeGeometry[] = [];
      let merged: THREE.BufferGeometry | null = null;

      const tryExtrudeAndMerge = async (
        settings: typeof extrudeSettings,
        shapes: THREE.Shape[],
      ): Promise<THREE.BufferGeometry | null> => {
        const geos: THREE.ExtrudeGeometry[] = [];
        for (let i = 0; i < shapes.length; i++) {
          if (cancelRef.current || version !== versionRef.current) {
            geos.forEach((g) => g.dispose());
            return null;
          }
          geos.push(new THREE.ExtrudeGeometry(shapes[i], settings));
          if ((i + 1) % BATCH_SIZE === 0) {
            setProgress(Math.round(((i + 1) / shapes.length) * 80));
            await yieldToMain();
          }
        }
        try {
          const m = BufferGeometryUtils.mergeGeometries(geos, false);
          if (!m) { geos.forEach((g) => g.dispose()); return null; }
          return m;
        } catch {
          geos.forEach((g) => g.dispose());
          return null;
        }
      };

      // Try with full quality first, then retry with lower quality on OOM
      merged = await tryExtrudeAndMerge(extrudeSettings, allShapes);

      if (!merged && !cancelRef.current && version === versionRef.current) {
        const reducedSettings = {
          ...extrudeSettings,
          curveSegments: Math.max(2, Math.floor(extrudeSettings.curveSegments * 0.3)),
          bevelSegments: Math.max(1, Math.floor(extrudeSettings.bevelSegments * 0.3)),
        };
        setProgress(50);
        await yieldToMain();
        merged = await tryExtrudeAndMerge(reducedSettings, allShapes);
      }

      if (!merged && !cancelRef.current && version === versionRef.current) {
        const minimalSettings = {
          ...extrudeSettings,
          curveSegments: 2,
          bevelSegments: 1,
          bevelEnabled: false,
        };
        setProgress(70);
        await yieldToMain();
        merged = await tryExtrudeAndMerge(minimalSettings, allShapes);
      }

      if (!merged || cancelRef.current || version !== versionRef.current) {
        setResult(EMPTY_RESULT);
        setLoading(false);
        return;
      }

      setProgress(96);
      await yieldToMain();

      // Step 5: UVs + centering
      merged.computeBoundingBox();
      merged.computeVertexNormals();
      recomputeTriplanarUVs(merged, merged.boundingBox!);

      const bb = merged.boundingBox!;
      const ctr = new THREE.Vector3();
      bb.getCenter(ctr);
      const size = new THREE.Vector3();
      bb.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const s = maxDim > 0 ? 4 / maxDim : 1;

      if (cancelRef.current || version !== versionRef.current) {
        merged.dispose();
        setLoading(false);
        return;
      }

      setProgress(100);
      setResult({ geometries: [merged], center: ctr, baseScale: s });
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

  const { geometries, center, baseScale, loading, progress } = useExtrudedGeometry(svgString, depth, smoothness);

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
        const isGold = materialSettings.preset === "gold";
        const isEmissive = materialSettings.preset === "emissive";
        const wantsTransparency = materialSettings.transparent || materialSettings.opacity < 1;

        // Per-shape color from PNG sampling, or fall back to the single color prop
        const shapeColor = colorMap?.[i] ?? color;
        const baseColor = texture ? "#ffffff" : isGold ? "#d4a017" : shapeColor;
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
              envMapIntensity={1}
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

      <Environment background={false} environmentIntensity={1.5} frames={1}>
        <mesh scale={50}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color="#0a0a12" side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 25, 0]}>
          <sphereGeometry args={[20, 32, 32]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 30]}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial color="#444444" />
        </mesh>
        <mesh position={[-20, 5, 10]}>
          <sphereGeometry args={[10, 32, 32]} />
          <meshBasicMaterial color="#333333" />
        </mesh>
      </Environment>

      {children}
    </Canvas>
  );
}

export default SVG3DScene;
