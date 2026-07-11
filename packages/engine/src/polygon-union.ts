/**
 * Boolean polygon union helpers using the polygon-clipping library.
 * Groups shapes by fill color and unions overlapping shapes of the same color
 * to eliminate internal edges before extrusion.
 */
import * as THREE from "three";

let _clipping: any = null;
async function getClipping() {
  if (!_clipping) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _clipping = await import("polygon-clipping");
  }
  return _clipping;
}

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

// ---------------------------------------------------------------------------
// THREE.Shape ↔ polygon-clipping conversion
// ---------------------------------------------------------------------------

/** Check if a ring has any NaN values */
function hasNaN(ring: Ring): boolean {
  for (const [x, y] of ring) {
    if (!isFinite(x) || !isFinite(y)) return true;
  }
  return false;
}

/** Validate a polygon: all rings must have >= 4 points (closed) and no NaN */
function isValidPolygon(polygon: Polygon): boolean {
  if (polygon.length === 0) return false;
  for (const ring of polygon) {
    if (ring.length < 4) return false; // need at least 3 unique + closing point
    if (hasNaN(ring)) return false;
  }
  return true;
}

/** Extract a ring (outer contour or hole) from a THREE.Path as polygon-clipping Ring */
function pathToRing(path: THREE.Path | THREE.Shape): Ring {
  // Use enough divisions to capture bezier curves accurately
  const pts = path.getPoints(24);
  const ring: Ring = [];
  for (const p of pts) {
    ring.push([p.x, p.y]);
  }
  // Close the ring if not already closed
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Convert a THREE.Shape to a polygon-clipping Polygon (outer + holes) */
function shapeToPolygon(shape: THREE.Shape): Polygon {
  const outerRing = pathToRing(shape);
  const polygon: Polygon = [outerRing];
  for (const hole of shape.holes) {
    polygon.push(pathToRing(hole));
  }
  return polygon;
}

/** Compute signed area of a ring (positive = CCW, negative = CW in screen coords) */
function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    area += (x1 - x0) * (y1 + y0);
  }
  return area / 2;
}

/** Ensure ring has correct winding: outer = CCW (positive area in screen coords), holes = CW */
function normalizeWinding(polygon: Polygon): Polygon {
  if (polygon.length === 0) return polygon;
  const outer = polygon[0];
  if (ringArea(outer) < 0) outer.reverse();
  for (let i = 1; i < polygon.length; i++) {
    if (ringArea(polygon[i]) > 0) polygon[i].reverse();
  }
  return polygon;
}

/** Convert a polygon-clipping Ring to THREE.Vector2[] */
function ringToPoints(ring: Ring): THREE.Vector2[] {
  return ring.map(([x, y]) => new THREE.Vector2(x, y));
}

/** Convert a polygon-clipping Polygon back to a THREE.Shape (with holes) */
function polygonToShape(polygon: Polygon): THREE.Shape | null {
  if (polygon.length === 0) return null;
  // Normalize winding before creating shape
  const normalized = normalizeWinding([...polygon.map(r => [...r] as Ring)]);
  const outerPoints = ringToPoints(normalized[0]);
  const shape = new THREE.Shape(outerPoints);
  for (let i = 1; i < normalized.length; i++) {
    const holePath = new THREE.Path(ringToPoints(normalized[i]));
    shape.holes.push(holePath);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Geometry cleanup helpers
// ---------------------------------------------------------------------------

/** Deduplicate nearly-collinear vertices in a ring (removes tiny edge artifacts) */
function deduplicateVertices(points: THREE.Vector2[], tolerance = 1e-6): THREE.Vector2[] {
  if (points.length < 3) return points;
  const result: THREE.Vector2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    // Skip if current point is nearly on the line between prev and next
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const cross = dx1 * dy2 - dy1 * dx2;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    if (Math.abs(cross) / (len1 * len2 + 1e-10) > tolerance) {
      result.push(curr);
    }
  }
  return result.length >= 3 ? result : points;
}

/** Merge vertices that are extremely close together */
function mergeCloseVertices(points: THREE.Vector2[], tolerance = 1e-4): THREE.Vector2[] {
  if (points.length < 3) return points;
  const result: THREE.Vector2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const curr = points[i];
    const dx = curr.x - last.x;
    const dy = curr.y - last.y;
    if (dx * dx + dy * dy > tolerance * tolerance) {
      result.push(curr);
    }
  }
  // Check if last point merged with first
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (dx * dx + dy * dy <= tolerance * tolerance) {
      result.pop();
    }
  }
  return result.length >= 3 ? result : points;
}

/** Remove degenerate triangles (zero-area) from the point list by removing near-duplicate points */
function cleanupRing(points: THREE.Vector2[]): THREE.Vector2[] {
  let result = mergeCloseVertices(points);
  result = deduplicateVertices(result);
  return result;
}

// ---------------------------------------------------------------------------
// Main API: boolean-union shapes by fill color
// ---------------------------------------------------------------------------

export interface ShapeWithFill {
  shape: THREE.Shape;
  fill: string;
}

const SVG_DEBUG = typeof window !== "undefined" && !!(window as any).__SVG3D_DEBUG;

function logDebug(...args: unknown[]) {
  if (SVG_DEBUG) console.log("[SVG3D]", ...args);
}

/**
 * Group shapes by fill color and boolean-union all shapes of the same color.
 * This eliminates internal contour lines that cause unwanted engravings.
 *
 * Returns a new array of ShapeWithFill where each color has at most one
 * merged polygon (which may contain holes where different sub-paths overlapped).
 */
export async function unionByColor(shapes: ShapeWithFill[]): Promise<ShapeWithFill[]> {
  logDebug(`unionByColor: input ${shapes.length} shapes`);

  // Group by fill color (normalize color strings for grouping)
  const groups = new Map<string, ShapeWithFill[]>();
  for (const s of shapes) {
    const key = s.fill.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  logDebug(`unionByColor: ${groups.size} unique colors`);

  const result: ShapeWithFill[] = [];

  for (const [color, group] of groups) {
    if (group.length === 1) {
      // Single shape — pass through as-is (cleanup can remove valid curve points)
      result.push(group[0]);
      continue;
    }

    logDebug(`unionByColor: unioning ${group.length} shapes for color ${color}`);

    // Convert all shapes to polygon-clipping format
    const polygons: MultiPolygon = group.map((s) => shapeToPolygon(s.shape));

    // Perform boolean union
    let unioned: MultiPolygon;
    try {
      unioned = (await getClipping()).union(...polygons);
    } catch (e) {
      // Fallback: if union fails, just use the original shapes
      logDebug(`unionByColor: union failed for ${color}, using originals`, e);
      result.push(...group);
      continue;
    }

    logDebug(`unionByColor: union result = ${unioned.length} polygons`);

    // Validate union results and fall back to originals if degenerate
    const hasDegenerate = unioned.some(p => !isValidPolygon(p));
    if (hasDegenerate) {
      logDebug(`unionByColor: degenerate polygon in union result for ${color}, using originals`);
      result.push(...group);
      continue;
    }

    // Convert back to THREE.Shape(s)
    for (const polygon of unioned) {
      // Skip degenerate results (tiny area or invalid)
      if (polygon.length === 0 || !isValidPolygon(polygon)) continue;

      const shape = polygonToShape(polygon);
      if (shape) {
        const pts = shape.getPoints(0);
        // Validate no NaN in output
        const valid = pts.every(p => isFinite(p.x) && isFinite(p.y));
        if (valid && pts.length >= 3) {
          result.push({ shape, fill: color });
        }
      }
    }
  }

  logDebug(`unionByColor: output ${result.length} shapes`);
  return result;
}
