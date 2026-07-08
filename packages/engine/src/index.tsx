/**
 * =============================================================================
 * SVG3D — Public API
 * =============================================================================
 *
 * Entry point for the 3dsvg engine. Resolves text-to-SVG via Google Fonts,
 * merges material presets with user overrides, and lazy-loads the Three.js
 * scene so the bundle stays lean for server-side rendering.
 *
 * @packageDocumentation
 */

import { useMemo, useState, useEffect, lazy, Suspense } from "react";
import { type SVG3DProps, defaultProps } from "./types";
import { resolveMaterial } from "./materials";
import { useFont, textToSvg } from "./use-font";
import type { SVG3DSceneProps } from "./scene";

function isSvgUrl(value: string): boolean {
  const trimmed = value.trimStart();
  if (trimmed.startsWith("<")) return false;
  return /^(https?:\/\/|\/|\.\/|\.\.\/)/.test(trimmed);
}

function useFetchSvg(url: string | undefined): string | undefined {
  const [fetched, setFetched] = useState<string | undefined>();

  useEffect(() => {
    if (!url) { setFetched(undefined); return; }
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setFetched(text); })
      .catch(() => { if (!cancelled) setFetched(undefined); });
    return () => { cancelled = true; };
  }, [url]);

  return fetched;
}

const SVG3DScene = lazy(() =>
  import("./scene").then((m) => ({ default: m.SVG3DScene }))
);

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"></svg>`;

export function SVG3D(props: SVG3DProps) {
  const {
    text,
    font = defaultProps.font,
    svg: svgProp,
    svgString: svgStringProp,
    depth = defaultProps.depth,
    smoothness = defaultProps.smoothness,
    color = defaultProps.color,
    colorMap = defaultProps.colorMap,
    material = defaultProps.material,
    metalness,
    roughness,
    opacity,
    wireframe,
    rotationX = defaultProps.rotationX,
    rotationY = defaultProps.rotationY,
    zoom = defaultProps.zoom,
    fov = defaultProps.fov,
    texture,
    textureRepeat = defaultProps.textureRepeat,
    textureRotation = defaultProps.textureRotation,
    textureOffset = defaultProps.textureOffset,
    lightPosition = defaultProps.lightPosition,
    lightIntensity = defaultProps.lightIntensity,
    ambientIntensity = defaultProps.ambientIntensity,
    shadow = defaultProps.shadow,
    interactive = true,
    cursorOrbit: cursorOrbitProp = defaultProps.cursorOrbit,
    orbitStrength = defaultProps.orbitStrength,
    draggable: draggableProp = defaultProps.draggable,
    scrollZoom: scrollZoomProp = defaultProps.scrollZoom,
    resetOnIdle = defaultProps.resetOnIdle,
    resetDelay = defaultProps.resetDelay,
    resetKey,
    animate = "none",
    animateSpeed = 1,
    animateReverse = false,
    intro = defaultProps.intro,
    introDuration = defaultProps.introDuration,
    introFrom = defaultProps.introFrom,
    introTo: introToProp,
    width = defaultProps.width,
    height = defaultProps.height,
    background = defaultProps.background,
    className,
    onReady,
    onAnimationComplete,
    onLoadingChange,
    registerCanvas,
    children,
  } = props;

  const cursorOrbit = interactive ? cursorOrbitProp : false;
  const draggable = interactive ? draggableProp : false;
  const scrollZoom = interactive ? scrollZoomProp : false;

  const containerStyle: React.CSSProperties = {
    width,
    height,
    position: "relative",
    background: "transparent",
  };

  const loadedFont = useFont(text ? font : "");

  // Resolve svg prop: new `svg` takes priority over deprecated `svgString`
  const rawSvg = svgProp ?? svgStringProp;
  const svgUrl = rawSvg && isSvgUrl(rawSvg) ? rawSvg : undefined;
  const fetchedSvg = useFetchSvg(svgUrl);

  const svgString = useMemo(() => {
    // URL is being fetched
    if (svgUrl) return fetchedSvg ?? "";
    // Raw SVG markup
    if (rawSvg !== undefined) return rawSvg;
    // Text-to-SVG
    if (text && loadedFont) return textToSvg(text, loadedFont);
    if (text && !loadedFont) return "";
    return FALLBACK_SVG;
  }, [text, loadedFont, rawSvg, svgUrl, fetchedSvg]);

  const materialSettings = useMemo(
    () => resolveMaterial(material, { metalness, roughness, opacity, wireframe }),
    [material, metalness, roughness, opacity, wireframe]
  );

  const loadingEl = (
    <div style={containerStyle} className={className} />
  );

  if (!svgString) {
    return loadingEl;
  }

  return (
    <div style={containerStyle} className={className}>
      <Suspense fallback={loadingEl}>
        <SVG3DScene
          svgString={svgString}
          depth={depth}
          smoothness={smoothness}
          color={color}
          colorMap={colorMap}
          materialSettings={materialSettings}
          rotationX={rotationX}
          rotationY={rotationY}
          zoom={zoom}
          fov={fov}
          texture={texture}
          textureRepeat={textureRepeat}
          textureRotation={textureRotation}
          textureOffset={textureOffset}
          lightPosition={lightPosition}
          lightIntensity={lightIntensity}
          ambientIntensity={ambientIntensity}
          shadow={shadow}
          cursorOrbit={cursorOrbit}
          orbitStrength={orbitStrength}
          draggable={draggable}
          scrollZoom={scrollZoom}
          resetOnIdle={resetOnIdle}
          resetDelay={resetDelay}
          resetKey={resetKey}
          animate={animate}
          animateSpeed={animateSpeed}
          animateReverse={animateReverse}
          intro={intro}
          introDuration={introDuration}
          introFrom={introFrom}
          introTo={{ ...defaultProps.introTo, ...introToProp, zoom: introToProp?.zoom ?? zoom }}
          background={background}
          onReady={onReady}
          onAnimationComplete={onAnimationComplete}
          onLoadingChange={onLoadingChange}
          registerCanvas={registerCanvas}
        >
          {children}
        </SVG3DScene>
      </Suspense>
    </div>
  );
}

// Types
export type { SVG3DProps, MaterialPreset } from "./types";
export { defaultProps } from "./types";

// Scene internals
export {
  SVG3DScene,
  ExtrudedSVG,
  useExtrudedGeometry,
} from "./scene";
export type {
  SVG3DSceneProps,
  ExtrudedSVGProps,
  ExtrudedGeometryResult,
} from "./scene";

// Controls
export {
  IntroAnimation,
  LoopAnimation,
  SmoothControls,
  introComplete,
} from "./controls";
export type {
  AnimationType,
  IntroAnimationProps,
  LoopAnimationProps,
  SmoothControlsProps,
} from "./controls";

// Materials
export { materialPresets, resolveMaterial } from "./materials";
export type { MaterialSettings } from "./materials";

// Font utilities
export { useFont, textToSvg } from "./use-font";

// PNG → 3D displacement mesh
export { PngTo3D, buildPngDisplacementMesh } from "./png-to-3d";
export type { PngTo3DProps } from "./png-to-3d";
