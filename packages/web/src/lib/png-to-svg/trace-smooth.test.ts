import { describe, it, expect } from "vitest";
import { detectGeometricShapes } from "./trace-smooth";

function circlePoints(cx: number, cy: number, r: number, n: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function rectPoints(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

describe("detectGeometricShapes", () => {
  it("detects a circle", () => {
    const pts = circlePoints(50, 50, 30, 64);
    const shapes = detectGeometricShapes([pts], 1);
    expect(shapes.length).toBe(1);
    expect(shapes[0]).toContain("<circle");
    expect(shapes[0]).toContain('cx="50.0"');
    expect(shapes[0]).toContain('cy="50.0"');
  });

  it("detects an ellipse", () => {
    // Ellipse with rx=30, ry=20 (within 10% tolerance of avgRadius check)
    const pts: { x: number; y: number }[] = [];
    const rx = 30, ry = 25;
    for (let i = 0; i < 64; i++) {
      const angle = (2 * Math.PI * i) / 64;
      pts.push({ x: 50 + rx * Math.cos(angle), y: 30 + ry * Math.sin(angle) });
    }
    const shapes = detectGeometricShapes([pts], 1);
    expect(shapes.length).toBe(1);
    expect(shapes[0]).toContain("<ellipse");
  });

  it("returns empty for non-shape contour", () => {
    // Random L-shaped contour
    const pts = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 50 }, { x: 0, y: 50 },
    ];
    const shapes = detectGeometricShapes([pts], 1);
    expect(shapes.length).toBe(0);
  });

  it("returns empty for tiny contour", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    const shapes = detectGeometricShapes([pts], 1);
    expect(shapes.length).toBe(0);
  });
});
