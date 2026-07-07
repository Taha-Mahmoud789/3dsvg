/**
 * Pixel grid vectorizer. Each pixel (or downsampled cell) becomes a <rect>.
 * Uses 2D greedy rectangle merging to minimize node count.
 */

export interface PixelGridOptions {
  gridResolution: number;
  smoothEdges: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Downsample image data to a grid of the given resolution.
 */
function downsample(
  indexed: Uint8Array,
  palette: [number, number, number, number][],
  srcW: number,
  srcH: number,
  gridRes: number
): { cells: Uint8Array; cellW: number; cellH: number; width: number; height: number } {
  if (gridRes <= 0) {
    // "original" resolution
    return { cells: indexed, cellW: 1, cellH: 1, width: srcW, height: srcH };
  }

  const cellW = Math.max(1, Math.ceil(srcW / gridRes));
  const cellH = Math.max(1, Math.ceil(srcH / gridRes));
  const w = Math.ceil(srcW / cellW);
  const h = Math.ceil(srcH / cellH);
  const cells = new Uint8Array(w * h);

  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const counts = new Map<number, number>();
      const startY = gy * cellH;
      const endY = Math.min(startY + cellH, srcH);
      const startX = gx * cellW;
      const endX = Math.min(startX + cellW, srcW);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const ci = indexed[y * srcW + x];
          counts.set(ci, (counts.get(ci) || 0) + 1);
        }
      }

      let bestCi = 0;
      let bestCount = 0;
      for (const [ci, count] of counts) {
        if (count > bestCount) {
          bestCount = count;
          bestCi = ci;
        }
      }
      cells[gy * w + gx] = bestCi;
    }
  }

  return { cells, cellW, cellH, width: w, height: h };
}

/**
 * 2D greedy largest-rectangle merging.
 * For each color, find the largest possible rectangle that fits entirely
 * within same-color cells, mark it, and repeat.
 */
function mergeRects(cells: Uint8Array, w: number, h: number): Rect[] {
  const used = new Uint8Array(w * h);
  const rects: Rect[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (used[idx]) continue;

      const color = cells[idx];

      // Find max width
      let maxW = 0;
      while (x + maxW < w && cells[y * w + x + maxW] === color && !used[y * w + x + maxW]) {
        maxW++;
      }

      // Find max height for this width
      let maxH = 1;
      outer: while (y + maxH < h) {
        for (let dx = 0; dx < maxW; dx++) {
          if (cells[(y + maxH) * w + x + dx] !== color || used[(y + maxH) * w + x + dx]) {
            break outer;
          }
        }
        maxH++;
      }

      // Mark as used
      for (let dy = 0; dy < maxH; dy++) {
        for (let dx = 0; dx < maxW; dx++) {
          used[(y + dy) * w + x + dx] = 1;
        }
      }

      rects.push({ x, y, w: maxW, h: maxH });
    }
  }

  return rects;
}

export function tracePixelGrid(
  indexed: Uint8Array,
  palette: [number, number, number, number][],
  srcWidth: number,
  srcHeight: number,
  options: PixelGridOptions
): string {
  const { gridResolution, smoothEdges } = options;

  const { cells, cellW, cellH, width: gridW, height: gridH } = downsample(
    indexed, palette, srcWidth, srcHeight, gridResolution
  );

  const rects = mergeRects(cells, gridW, gridH);

  const parts: string[] = [];

  for (const rect of rects) {
    const ci = cells[rect.y * gridW + rect.x];
    const [r, g, b, a] = palette[ci];
    if (a < 128) continue;

    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    const x = rect.x * cellW;
    const y = rect.y * cellH;
    const w = rect.w * cellW;
    const h = rect.h * cellH;
    const opacity = a < 255 ? ` opacity="${(a / 255).toFixed(2)}"` : "";

    if (smoothEdges) {
      // Slight rounding for softened look
      const rx = Math.min(2, w * 0.1, h * 0.1);
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx.toFixed(1)}" fill="${hex}"${opacity}/>`
      );
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex}"${opacity}/>`);
    }
  }

  return parts.join("\n");
}
