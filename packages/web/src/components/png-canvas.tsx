/**
 * =============================================================================
 * PNG-to-3D Canvas
 * =============================================================================
 *
 * Web editor wrapper for the displacement-mapped PNG mesh.  Mirrors the
 * structure of svg-to-3d-canvas.tsx but replaces the SVG3D component with
 * the PngTo3D displacement mesh, and provides GLB export via GLTFExporter.
 *
 * @packageDocumentation
 */

"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { optimizeGlb } from "@/lib/optimize-glb";

import { PngTo3D } from "3dsvg";
import type { PngTo3DProps } from "3dsvg";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function collectExportableMeshes(scene: THREE.Scene): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (!obj.visible) return;
    // Include any mesh with a StandardMaterial (displacement meshes)
    if (Array.isArray(obj.material)) return;
    if (!(obj.material instanceof THREE.MeshStandardMaterial)) return;
    meshes.push(obj);
  });
  return meshes;
}

function optimizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let optimized = mergeVertices(geo, 1e-4);
  const pos = optimized.attributes.position;
  if (pos) {
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.round(arr[i] * 10000) / 10000;
    }
    pos.needsUpdate = true;
  }
  return optimized;
}

function buildExportGroup(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  const meshes = collectExportableMeshes(scene);

  // Group meshes by color for geometry merging
  const colorKey = (c: THREE.Color) =>
    `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}`;
  const byColor = new Map<string, { geometries: THREE.BufferGeometry[]; material: THREE.MeshStandardMaterial }>();

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const srcMat = (mesh.material as THREE.MeshStandardMaterial).clone();
    const key = colorKey(srcMat.color);

    if (!byColor.has(key)) {
      byColor.set(key, { geometries: [], material: srcMat });
    }
    byColor.get(key)!.geometries.push(geometry);
  }

  for (const { geometries, material } of byColor.values()) {
    let merged: THREE.BufferGeometry;
    if (geometries.length === 1) {
      merged = geometries[0];
    } else {
      const result = mergeGeometries(geometries, false);
      if (!result) continue;
      merged = result;
    }
    merged = optimizeGeometry(merged);
    group.add(new THREE.Mesh(merged, material));
  }

  return group;
}

/* ------------------------------------------------------------------ */
/*  GLB Export                                                         */
/* ------------------------------------------------------------------ */

function PngExportCapture({
  register3DExport,
}: {
  register3DExport?: (fn: (format: string, filename?: string) => void) => void;
}) {
  const { scene } = useThree();

  useEffect(() => {
    if (!register3DExport) return;
    register3DExport((format, filename = "svg-to-3d") => {
      if (format !== "glb") return;

      const group = buildExportGroup(scene);
      if (group.children.length === 0) return;

      new GLTFExporter().parse(
        group,
        async (result) => {
          const raw = result instanceof ArrayBuffer
            ? result
            : new TextEncoder().encode(JSON.stringify(result)).buffer;
          try {
            const optimized = await optimizeGlb(raw);
            triggerDownload(new Blob([optimized], { type: "model/gltf-binary" }), `${filename}.glb`);
          } catch {
            triggerDownload(new Blob([raw], { type: "model/gltf-binary" }), `${filename}.glb`);
          }
        },
        (err) => console.error("GLB export failed", err),
        { binary: true },
      );
    });
  }, [scene, register3DExport]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  ReadyNotifier                                                      */
/* ------------------------------------------------------------------ */

function ReadyNotifier({ onReady }: { onReady?: () => void }) {
  const readyFired = useRef(false);

  useFrame(() => {
    if (!readyFired.current) {
      readyFired.current = true;
      onReady?.();
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/*  PngTo3DCanvas — main exported component                            */
/* ------------------------------------------------------------------ */

export interface PngTo3DCanvasProps {
  pngUrl: string;
  bgColor: string;
  displacementScale?: number;
  segments?: number;
  zoom?: number;
  cursorOrbit?: boolean;
  resetOnIdle?: boolean;
  resetDelay?: number;
  animate?: "none" | "spin";
  animateSpeed?: number;
  registerCanvas?: (canvas: HTMLCanvasElement) => void;
  register3DExport?: (fn: (format: string, filename?: string) => void) => void;
}

export function PngTo3DCanvas({
  pngUrl,
  bgColor,
  displacementScale = 5,
  segments = 256,
  zoom = 8,
  cursorOrbit = true,
  resetOnIdle = false,
  resetDelay = 2,
  animate = "none",
  animateSpeed = 1,
  registerCanvas,
  register3DExport,
}: PngTo3DCanvasProps) {
  const [isLoading, setIsLoading] = useState(true);
  const meshGroupRef = useRef<THREE.Group>(null);

  return (
    <>
      {/* Loading overlay */}
      <div
        className={`absolute inset-0 z-20 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${
          isLoading ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-xl px-4 py-2">
          <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-xs text-white/70">Loading PNG…</span>
        </div>
      </div>

      <Canvas
        camera={{ position: [0, 0, zoom], fov: 50 }}
        style={{ background: bgColor, visibility: "hidden" }}
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        onCreated={({ gl, scene }) => {
          if (bgColor && bgColor !== "transparent") {
            scene.background = new THREE.Color(bgColor);
          }
          registerCanvas?.(gl.domElement);
        }}
      >
        <ReadyNotifier onReady={() => setIsLoading(false)} />

        {/* Lighting — same setup as SVG canvas for visual consistency */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
        <directionalLight position={[-5, 3, -3]} intensity={0.4} />
        <directionalLight position={[0, -4, 6]} intensity={0.2} />
        <pointLight position={[0, 5, 0]} intensity={0.3} />
        <hemisphereLight args={["#b1e1ff", "#b97a20", 0.5]} />

        {/* Controls */}
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          enableRotate={true}
          autoRotate={animate === "spin"}
          autoRotateSpeed={animateSpeed * 2}
          target={[0, 0, 0]}
        />

        {/* The displacement mesh */}
        <group ref={meshGroupRef}>
          <PngTo3D
            pngUrl={pngUrl}
            segments={segments}
            displacementScale={displacementScale}
            width={6}
            onLoaded={() => setIsLoading(false)}
            onError={(err) => {
              console.error("PngTo3D load error:", err);
              setIsLoading(false);
            }}
          />
        </group>

        {/* Contact shadows */}
        <ContactShadows
          position={[0, -3, 0]}
          opacity={0.4}
          scale={10}
          blur={2}
          far={4}
        />

        {/* Environment for reflections */}
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
        </Environment>

        {/* GLB export capture */}
        <PngExportCapture register3DExport={register3DExport} />
      </Canvas>
    </>
  );
}
