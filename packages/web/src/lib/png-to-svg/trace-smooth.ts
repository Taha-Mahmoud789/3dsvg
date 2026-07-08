/**
 * Smooth potrace-style vector tracer.
 * Traces raster images into clean bezier curves with corner detection.
 */

export interface TraceOptions {
  colorCount: number;
  smoothing: number;
  speckleSize: number;
  colorMode: "full" | "grayscale" | "bw";
  bwThreshold: number;
  lockedColors: string[];
  fullColor: boolean;
  gradientMeta?: GradientMeta[];
}

interface ContourPoint {
  x: number;
  y: number;
  type: "line" | "curve";
  cx1?: number;
  cy1?: number;
  cx2?: number;
  cy2?: number;
}

function clockwise(pts: { x: number; y: number }[]): boolean {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return sum > 0;
}

function traceContour(
  indexed: Uint8Array,
  w: number,
  h: number,
  colorIdx: number
): { x: number; y: number }[][] {
  const visited = new Uint8Array(w * h);
  const isColor = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h && indexed[y * w + x] === colorIdx;
  const edges: { x: number; y: number }[][] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isColor(x, y) || visited[y * w + x]) continue;
      if (isColor(x - 1, y)) continue; // already left edge

      const contour: { x: number; y: number }[] = [];
      let cx = x,
        cy = y;
      let prevDir = 0; // 0=right,1=down,2=left,3=up

      do {
        visited[cy * w + cx] = 1;
        contour.push({ x: cx, y: cy });

        // Moore neighborhood tracing — skip visited pixels to prevent cycles,
        // but allow return to start point to close the contour
        const dirs = [
          [1, 0],
          [1, 1],
          [0, 1],
          [-1, 1],
          [-1, 0],
          [-1, -1],
          [0, -1],
          [1, -1],
        ];
        let found = false;
        for (let d = 0; d < 8; d++) {
          const idx = (prevDir + 6 + d) % 8;
          const nx = cx + dirs[idx][0];
          const ny = cy + dirs[idx][1];
          if (isColor(nx, ny) && (nx === x && ny === y || !visited[ny * w + nx])) {
            cx = nx;
            cy = ny;
            prevDir = (idx + 4) % 8;
            found = true;
            break;
          }
        }
        if (!found) break;
      } while (cx !== x || cy !== y);

      if (contour.length >= 3) edges.push(contour);
    }
  }

  return edges;
}

function simplifyPath(
  points: { x: number; y: number }[],
  tolerance: number
): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  // Iterative Douglas-Peucker to avoid stack overflow on large contours
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;

    let maxDist = 0;
    let maxIdx = start;
    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i++) {
      const d = pointLineDistance(points[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }

    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

function pointLineDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function contoursToPath(
  contours: { x: number; y: number }[][],
  tolerance: number
): string[] {
  return contours.map((pts) => {
    const simplified = simplifyPath([...pts, pts[0]], tolerance);
    if (simplified.length <= 1) return "";

    let d = `M ${simplified[0].x} ${simplified[0].y}`;

    if (simplified.length === 2) {
      d += ` L ${simplified[1].x} ${simplified[1].y}`;
    } else {
      for (let i = 1; i < simplified.length - 1; i++) {
        const prev = simplified[i - 1];
        const curr = simplified[i];
        const next = simplified[i + 1];

        const mx1 = (prev.x + curr.x) / 2;
        const my1 = (prev.y + curr.y) / 2;
        const mx2 = (curr.x + next.x) / 2;
        const my2 = (curr.y + next.y) / 2;

        d += ` Q ${curr.x} ${curr.y} ${mx2} ${my2}`;
      }
      const last = simplified[simplified.length - 1];
      d += ` L ${last.x} ${last.y}`;
    }

    return d + " Z";
  });
}

/**
 * Expand contour points outward by `bleed` pixels (anti-seam trapping).
 * Prevents visible gaps between adjacent color regions in the SVG.
 */
function expandContour(
  pts: { x: number; y: number }[],
  bleed: number
): { x: number; y: number }[] {
  if (bleed <= 0 || pts.length < 3) return pts;

  // Compute outward normals at each vertex and shift points
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    // Edge normals (perpendicular to edges, averaged)
    const e1x = pts[i].x - prev.x;
    const e1y = pts[i].y - prev.y;
    const e2x = next.x - pts[i].x;
    const e2y = next.y - pts[i].y;
    // Outward normal = rotate edge 90° clockwise, average of two edges
    const nx = -(e1y + e2y);
    const ny = e1x + e2x;
    const len = Math.hypot(nx, ny) || 1;
    result.push({
      x: pts[i].x + (nx / len) * bleed,
      y: pts[i].y + (ny / len) * bleed,
    });
  }
  return result;
}

/**
 * Check if a contour is thin/elongated enough to be a stroke-based line.
 * Returns null if it's a filled region, or { cx, cy, x1, y1, x2, y2, width }
 * if it looks like a stroke line.
 */
function detectStroke(
  contour: { x: number; y: number }[]
): { cx: number; cy: number; x1: number; y1: number; x2: number; y2: number; width: number } | null {
  if (contour.length < 4 || contour.length > 500) return null;

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of contour) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  // Skip large bounding boxes — too expensive for fill-count and O(n²) farthest-point
  if (bboxW > 200 || bboxH > 200) return null;
  const avgDim = (bboxW + bboxH) / 2;
  const ratio = Math.max(bboxW, bboxH) / (Math.min(bboxW, bboxH) || 1);

  // Must be elongated (aspect ratio > 4:1) and thin (avg dimension > 6px for it to matter)
  if (ratio < 4 || avgDim < 6) return null;

  // Compute fill area ratio (how much of bbox is actually filled)
  // A stroke fills very little of its bounding box
  let fillCount = 0;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      // Check if this pixel is inside the contour (point-in-polygon)
      let inside = false;
      for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const xi = contour[i].x, yi = contour[i].y;
        const xj = contour[j].x, yj = contour[j].y;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) fillCount++;
    }
  }

  const bboxArea = (Math.ceil(bboxW) + 1) * (Math.ceil(bboxH) + 1);
  const fillRatio = fillCount / bboxArea;

  // Strokes typically fill < 25% of their bounding box
  if (fillRatio > 0.25) return null;

  // Find the two endpoints (farthest apart points on the contour)
  let maxDist = 0;
  let p1 = contour[0], p2 = contour[1];
  for (let i = 0; i < contour.length; i++) {
    for (let j = i + 1; j < contour.length; j++) {
      const d = Math.hypot(contour[i].x - contour[j].x, contour[i].y - contour[j].y);
      if (d > maxDist) {
        maxDist = d;
        p1 = contour[i];
        p2 = contour[j];
      }
    }
  }

  const strokeW = Math.max(1, Math.round(avgDim * fillRatio * 2));

  return {
    cx: (p1.x + p2.x) / 2,
    cy: (p1.y + p2.y) / 2,
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    width: strokeW,
  };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function isColorInGradientRange(
  r: number, g: number, b: number,
  start: [number, number, number],
  end: [number, number, number]
): boolean {
  // Check if color is roughly between start and end (within ±25 per channel)
  for (let ch = 0; ch < 3; ch++) {
    const lo = Math.min(start[ch], end[ch]) - 25;
    const hi = Math.max(start[ch], end[ch]) + 25;
    const val = [r, g, b][ch];
    if (val < lo || val > hi) return false;
  }
  return true;
}

export function traceSmooth(
  indexed: Uint8Array,
  palette: [number, number, number, number][],
  width: number,
  height: number,
  options: TraceOptions
): string {
  const { smoothing, speckleSize, gradientMeta } = options;
  const tolerance = (1 - smoothing / 100) * 3;
  const SEAM_BLEED = 0.5; // ponytail: fixed 0.5px bleed, tune if seams still visible

  // Build a lookup: hex → gradient id (for colors within gradient range)
  const hexToGradient = new Map<string, string>();
  if (gradientMeta) {
    for (const g of gradientMeta) {
      const startRgb = hexToRgb(g.startColor);
      const endRgb = hexToRgb(g.endColor);
      if (!startRgb || !endRgb) continue;
      // Map every palette color that falls between start and end to this gradient
      for (const [r, g2, b, a] of palette) {
        if (a < 128) continue;
        const hex = rgbToHex(r, g2, b);
        if (hexToGradient.has(hex)) continue;
        if (isColorInGradientRange(r, g2, b, startRgb, endRgb)) {
          hexToGradient.set(hex, g.id);
        }
      }
    }
  }

  const groups: string[] = []; // grouped by color

  for (let ci = 0; ci < palette.length; ci++) {
    const [r, g, b, a] = palette[ci];
    if (a < 128) continue;

    const contours = traceContour(indexed, width, height, ci);
    const validContours = contours.filter((c) => c.length >= speckleSize);

    if (validContours.length === 0) continue;

    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    const opacity = a < 255 ? ` opacity="${(a / 255).toFixed(2)}"` : "";
    const gradId = hexToGradient.get(hex);
    const fill = gradId ? `fill="url(#${gradId})"` : `fill="${hex}"`;
    const groupParts: string[] = [];

    // Try pixel-based shape detection first (more reliable than contour-based)
    const pixelShape = detectShapeFromPixels(indexed, width, height, ci, tolerance + 1);
    if (pixelShape) {
      groupParts.push(pixelShape.replace("/>", ` ${fill}${opacity}/>`));
    } else {
      // Fallback: individual contour paths
      for (let i = 0; i < validContours.length; i++) {
        const contour = validContours[i];

        const stroke = detectStroke(contour);
        if (stroke) {
          const strokeAttr = gradId ? `stroke="url(#${gradId})"` : `stroke="${hex}"`;
          groupParts.push(
            `<line x1="${stroke.x1.toFixed(1)}" y1="${stroke.y1.toFixed(1)}" x2="${stroke.x2.toFixed(1)}" y2="${stroke.y2.toFixed(1)}" ${strokeAttr} stroke-width="${stroke.width}" stroke-linecap="round"${opacity}/>`
          );
          continue;
        }

        const bleedContour = expandContour(contour, SEAM_BLEED);
        const pathData = contoursToPath([bleedContour], tolerance);
        if (pathData.length === 0) continue;

        groupParts.push(
          `<path d="${pathData[0]}" ${fill}${opacity} fill-rule="evenodd"/>`
        );
      }
    }

    if (groupParts.length > 0) {
      groups.push(`<g data-color="${ci}">${groupParts.join("")}</g>`);
    }
  }

  return groups.join("\n");
}

export interface GradientMeta {
  id: string;
  direction: "h" | "v";
  minPos: number;
  maxPos: number;
  startColor: string;
  endColor: string;
}

export interface GradientInfo {
  defs: string;
  meta: GradientMeta[];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Detect smooth color gradients in the image and output SVG gradient defs
 * plus metadata so traceSmooth can link path fills to gradients.
 */
export function detectGradients(
  imageData: ImageData,
  _indexed: Uint8Array,
  _palette: [number, number, number, number][],
  width: number,
  height: number
): GradientInfo {
  const { data } = imageData;
  const defs: string[] = [];
  const meta: GradientMeta[] = [];

  const checkGradient = (
    colors: [number, number, number][],
    direction: "h" | "v",
    pos: number
  ) => {
    if (colors.length < 4) return;

    let isGradient = true;
    let channelsChecked = 0;
    for (let ch = 0; ch < 3; ch++) {
      let increasing = 0;
      let decreasing = 0;
      let hasVariation = false;
      for (let i = 1; i < colors.length; i++) {
        const diff = colors[i][ch] - colors[i - 1][ch];
        if (diff > 2) increasing++;
        else if (diff < -2) { decreasing++; hasVariation = true; }
        if (diff > 2) hasVariation = true;
      }
      // Only check channels that actually vary (skip constant channels like green=0)
      if (!hasVariation) continue;
      channelsChecked++;
      if (increasing < colors.length * 0.6 && decreasing < colors.length * 0.6) {
        isGradient = false;
        break;
      }
    }
    // Need at least 1 varying channel that shows monotonic trend
    if (channelsChecked === 0) isGradient = false;

    if (isGradient) {
      const startColor = colors[0];
      const endColor = colors[colors.length - 1];
      const id = `grad-${direction}-${pos}`;
      const startHex = rgbToHex(startColor[0], startColor[1], startColor[2]);
      const endHex = rgbToHex(endColor[0], endColor[1], endColor[2]);

      const axis = direction === "h" ? "x" : "y";
      const attrs = direction === "h"
        ? `x1="0%" y1="0%" x2="100%" y2="0%"`
        : `x1="0%" y1="0%" x2="0%" y2="100%"`;

      defs.push(
        `<linearGradient id="${id}" ${attrs}>` +
        `<stop offset="0%" stop-color="${startHex}"/>` +
        `<stop offset="100%" stop-color="${endHex}"/>` +
        `</linearGradient>`
      );
      meta.push({ id, direction, minPos: 0, maxPos: direction === "h" ? height : width, startColor: startHex, endColor: endHex });
    }
  };

  // Horizontal gradients (scan rows)
  const sampleRows = [Math.floor(height * 0.25), Math.floor(height * 0.5), Math.floor(height * 0.75)];
  for (const row of sampleRows) {
    if (row >= height) continue;
    const colors: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(width / 20));
    for (let x = 0; x < width; x += step) {
      const idx = (row * width + x) * 4;
      colors.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    checkGradient(colors, "h", row);
  }

  // Vertical gradients (scan columns)
  const sampleCols = [Math.floor(width * 0.25), Math.floor(width * 0.5), Math.floor(width * 0.75)];
  for (const col of sampleCols) {
    if (col >= width) continue;
    const colors: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(height / 20));
    for (let y = 0; y < height; y += step) {
      const idx = (y * width + col) * 4;
      colors.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    checkGradient(colors, "v", col);
  }

  return {
    defs: defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "",
    meta,
  };
}

/**
 * Smooth a contour by averaging each point with its neighbors.
 * Reduces staircase artifacts from pixel-grid tracing.
 */
function smoothContour(
  pts: { x: number; y: number }[],
  iterations: number
): { x: number; y: number }[] {
  if (pts.length < 4 || iterations <= 0) return pts;
  let result = [...pts];
  for (let iter = 0; iter < iterations; iter++) {
    const next: { x: number; y: number }[] = [];
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const curr = result[i];
      const nnext = result[(i + 1) % result.length];
      next.push({
        x: (prev.x + curr.x * 2 + nnext.x) / 4,
        y: (prev.y + curr.y * 2 + nnext.y) / 4,
      });
    }
    result = next;
  }
  return result;
}

/**
 * Detect geometric shapes directly from pixel data (indexed image).
 * More reliable than contour-based detection since the contour tracer
 * produces many tiny 4-point segments instead of clean boundaries.
 */
export function detectShapeFromPixels(
  indexed: Uint8Array,
  width: number,
  height: number,
  colorIdx: number,
  tolerance: number
): string | null {
  const totalPixels = width * height;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indexed[y * width + x] === colorIdx) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count < 10) return null;

  // Skip shape detection for dominant colors (>50% of image) — too expensive and unlikely to be a simple shape
  if (count > totalPixels * 0.5) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const avgR = (bboxW + bboxH) / 4;

  // Check circle: for a filled circle, most pixels should be within the bounding circle
  if (Math.abs(bboxW - bboxH) < avgR * 0.2) {
    const circleArea = Math.PI * avgR * avgR;
    const fillRatio = count / circleArea;
    if (fillRatio > 0.7 && fillRatio < 1.3) {
      // Verify: count pixels inside the bounding circle
      let insideCircle = 0;
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
          if (indexed[y * width + x] !== colorIdx) continue;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist <= avgR + 1) insideCircle++;
        }
      }
      if (insideCircle / count > 0.95) {
        return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${avgR.toFixed(1)}"/>`;
      }
    }
  }

  // Check rectangle: pixels should fill the bounding box
  const bboxArea = bboxW * bboxH;
  if (count / bboxArea > 0.85 && bboxW > 2 && bboxH > 2) {
    return `<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${bboxW.toFixed(1)}" height="${bboxH.toFixed(1)}"/>`;
  }

  return null;
}

export function detectGeometricShapes(
  contours: { x: number; y: number }[][],
  _tolerance: number
): string[] {
  const shapes: string[] = [];

  for (const contour of contours) {
    if (contour.length < 8) continue;

    // Smooth the contour to reduce pixel staircase artifacts before checking
    const smoothed = smoothContour(contour, 2);

    // Check for ellipse (fit bounding ellipse)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of smoothed) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;

    // Check if contour is close to the bounding ellipse
    let maxDeviation = 0;
    for (const p of smoothed) {
      const angle = Math.atan2(p.y - cy, p.x - cx);
      const expectedX = cx + rx * Math.cos(angle);
      const expectedY = cy + ry * Math.sin(angle);
      const dev = Math.hypot(p.x - expectedX, p.y - expectedY);
      maxDeviation = Math.max(maxDeviation, dev);
    }

    const avgRadius = (rx + ry) / 2;
    if (maxDeviation < avgRadius * 0.15) {
      if (Math.abs(rx - ry) < avgRadius * 0.1) {
        shapes.push(
          `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${avgRadius.toFixed(1)}"/>`
        );
      } else {
        shapes.push(
          `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/>`
        );
      }
      continue;
    }

    // Check for rectangle: contour should fill ≥85% of bounding box
    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    if (bboxW > 2 && bboxH > 2 && smoothed.length >= 4) {
      // Count how many contour points are near the bbox edges
      let nearEdge = 0;
      const edgeTolerance = Math.max(1.5, Math.min(bboxW, bboxH) * 0.1);
      for (const p of smoothed) {
        const onLeft = Math.abs(p.x - minX) < edgeTolerance;
        const onRight = Math.abs(p.x - maxX) < edgeTolerance;
        const onTop = Math.abs(p.y - minY) < edgeTolerance;
        const onBottom = Math.abs(p.y - maxY) < edgeTolerance;
        if (onLeft || onRight || onTop || onBottom) nearEdge++;
      }
      const edgeRatio = nearEdge / smoothed.length;
      if (edgeRatio > 0.7) {
        shapes.push(
          `<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${bboxW.toFixed(1)}" height="${bboxH.toFixed(1)}"/>`
        );
      }
    }
  }

  return shapes;
}
