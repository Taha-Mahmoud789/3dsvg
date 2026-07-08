/**
 * =============================================================================
 * PNG → 3D Displacement Mesh
 * =============================================================================
 *
 * Loads a PNG image directly as a texture and renders it on a high-density
 * PlaneGeometry with displacement mapping.  The PNG's red/luminance channel
 * drives the displacement height, and the full-color image maps onto the
 * surface — preserving 100% of the original detail, gradients, and colors.
 *
 * This replaces the SVG/Potrace pipeline for raster inputs, guaranteeing
 * pixel-perfect fidelity that vectorization can never achieve.
 *
 * @packageDocumentation
 */

import { useRef, useMemo, useState, useEffect } from "react";
import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PngTo3DProps {
  /** URL of the PNG image (object URL, http(s), or path). */
  pngUrl: string;
  /**
   * Number of segments along each axis for the PlaneGeometry.
   * Higher = smoother displacement but heavier geometry.
   * @default 256
   */
  segments?: number;
  /**
   * Maximum displacement distance in world units.
   * Controls how "thick" or "deep" the 3D relief appears.
   * @default 5
   */
  displacementScale?: number;
  /**
   * Vertical offset added after displacement (shifts the entire mesh up/down).
   * Useful for centering the depth range. @default -2.5
   */
  displacementBias?: number;
  /** PBR metalness (0–1). @default 0.1 */
  metalness?: number;
  /** PBR roughness (0–1). @default 0.6 */
  roughness?: number;
  /**
   * Target width in world units.  The height is computed from the
   * image's aspect ratio. @default 6
   */
  width?: number;
  /** Rotation around the X axis (radians). @default -Math.PI / 2 (flat on ground) */
  rotationX?: number;
  /** Rotation around the Y axis (radians). @default 0 */
  rotationY?: number;
  /** Callback when the texture finishes loading. */
  onLoaded?: () => void;
  /** Callback on texture load error. */
  onError?: (error: Error) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Renders a PNG image as a 3D displaced plane mesh.
 *
 * The PNG is loaded as a `THREE.Texture` and applied to both:
 * - `map` — the albedo/diffuse color (preserves all original colors)
 * - `displacementMap` — drives vertex displacement via the red channel
 *
 * A high-density `PlaneGeometry` (default 256×256 segments) ensures
 * smooth, artifact-free displacement even on complex images with fine
 * lines, gradients, or overlapping colors.
 *
 * @example
 * ```tsx
 * <Canvas>
 *   <PngTo3D
 *     pngUrl={objectUrl}
 *     segments={256}
 *     displacementScale={5}
 *     width={6}
 *   />
 * </Canvas>
 * ```
 */
export function PngTo3D({
  pngUrl,
  segments = 256,
  displacementScale = 5,
  displacementBias = -2.5,
  metalness = 0.1,
  roughness = 0.6,
  width: targetWidth = 6,
  rotationX = -Math.PI / 2,
  rotationY = 0,
  onLoaded,
  onError,
}: PngTo3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState(1);

  /* ---- Load texture ---- */
  useEffect(() => {
    if (!pngUrl) return;

    const loader = new THREE.TextureLoader();
    let cancelled = false;

    loader.load(
      pngUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setTexture(tex);

        // Derive aspect ratio from the loaded image
        const img = tex.image as HTMLImageElement;
        if (img?.naturalWidth && img?.naturalHeight) {
          setAspect(img.naturalWidth / img.naturalHeight);
        }
        onLoaded?.();
      },
      undefined,
      (err) => {
        if (!cancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          onError?.(error);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [pngUrl, onLoaded, onError]);

  /* ---- Derived dimensions ---- */
  const planeWidth = targetWidth;
  const planeHeight = targetWidth / aspect;

  /* ---- Geometry (rebuilds when aspect or segments change) ---- */
  const geometry = useMemo(
    () => new THREE.PlaneGeometry(planeWidth, planeHeight, segments, segments),
    [planeWidth, planeHeight, segments],
  );

  /* ---- Cleanup ---- */
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!texture) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      rotation={[rotationX, rotationY, 0]}
      position={[0, 0, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        map={texture}
        displacementMap={texture}
        displacementScale={displacementScale}
        displacementBias={displacementBias}
        metalness={metalness}
        roughness={roughness}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Geometry builder (non-React, for export pipelines)                 */
/* ------------------------------------------------------------------ */

/**
 * Build a displaced plane geometry from a PNG URL.  Returns a fully
 * textured, displaced `THREE.Mesh` ready for GLB export.
 *
 * Unlike the React component, this is a one-shot async function that
 * resolves when the texture is loaded — suitable for server-side or
 * headless export contexts.
 *
 * @internal Used by the web export pipeline.
 */
export async function buildPngDisplacementMesh(
  pngUrl: string,
  options: {
    segments?: number;
    displacementScale?: number;
    displacementBias?: number;
    metalness?: number;
    roughness?: number;
    width?: number;
  } = {},
): Promise<THREE.Mesh> {
  const {
    segments = 256,
    displacementScale = 5,
    displacementBias = -2.5,
    metalness = 0.1,
    roughness = 0.6,
    width: targetWidth = 6,
  } = options;

  // Load texture
  const texture = await new Promise<THREE.Texture>((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      pngUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });

  const img = texture.image as HTMLImageElement;
  const aspect = img?.naturalWidth && img?.naturalHeight
    ? img.naturalWidth / img.naturalHeight
    : 1;

  const planeWidth = targetWidth;
  const planeHeight = targetWidth / aspect;

  const geometry = new THREE.PlaneGeometry(
    planeWidth,
    planeHeight,
    segments,
    segments,
  );

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    displacementMap: texture,
    displacementScale,
    displacementBias,
    metalness,
    roughness,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}
