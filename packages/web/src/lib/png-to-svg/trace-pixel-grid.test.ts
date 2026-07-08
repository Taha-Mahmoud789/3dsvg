import { describe, it, expect } from "vitest";
import { mergeRects, type Rect } from "./trace-pixel-grid";

describe("mergeRects", () => {
  it("merges a solid 2x2 block into one rect", () => {
    // 2x2 grid, all same color (index 1)
    const cells = new Uint8Array([1, 1, 1, 1]);
    const rects = mergeRects(cells, 2, 2);
    expect(rects.length).toBe(1);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("keeps different colors as separate rects", () => {
    const cells = new Uint8Array([0, 1, 1, 0]);
    const rects = mergeRects(cells, 2, 2);
    // Each cell is its own color, greedy merges adjacent same-color cells
    // [0,0]=0单独, [0,1]&[1,0] are different colors from [1,1]
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it("merges a full row into one rect", () => {
    const cells = new Uint8Array([2, 2, 2, 2]);
    const rects = mergeRects(cells, 4, 1);
    expect(rects.length).toBe(1);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 4, h: 1 });
  });

  it("merges a full column into one rect", () => {
    const cells = new Uint8Array([3, 3, 3]);
    const rects = mergeRects(cells, 1, 3);
    expect(rects.length).toBe(1);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 1, h: 3 });
  });

  it("handles empty grid", () => {
    const cells = new Uint8Array(0);
    const rects = mergeRects(cells, 0, 0);
    expect(rects.length).toBe(0);
  });

  it("covers all cells exactly", () => {
    // 3x3 checkerboard pattern
    const cells = new Uint8Array([
      0, 1, 0,
      1, 0, 1,
      0, 1, 0,
    ]);
    const rects = mergeRects(cells, 3, 3);
    // Total area of all rects should equal 9
    const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(totalArea).toBe(9);
  });
});
