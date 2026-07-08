/**
 * Client-side wrapper for the server-side PNG → SVG conversion API.
 *
 * Sends the raw PNG buffer to `/api/convert-png` and returns the optimised
 * SVG string.  The heavy lifting (sharp + potrace) runs on the server,
 * keeping the browser bundle lightweight.
 *
 * @packageDocumentation
 */

export interface ServerConvertResult {
  svg: string;
  sizeBytes: number;
  originalBytes: number;
}

export interface ColorLayer {
  color: string;
  svgString: string;
  pixelCount: number;
  percentage: number;
}

export interface ServerMultiColorResult {
  mode: "multi-color";
  layers: ColorLayer[];
  composite: string;
  width: number;
  height: number;
  sizeBytes: number;
  palette: string[];
  originalBytes: number;
}

/**
 * POST a PNG `File` or `Blob` to the server-side vectorization endpoint.
 *
 * @throws on HTTP errors (non-2xx) or network failure.
 */
export async function convertPngViaServer(
  pngBlob: Blob,
): Promise<ServerConvertResult> {
  const res = await fetch("/api/convert-png", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: pngBlob,
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error ?? `Server responded ${res.status}`);
  }

  return json as ServerConvertResult;
}

/**
 * POST a PNG `File` or `Blob` to the server-side multi-color vectorization
 * endpoint.  Extracts dominant colors and vectorizes each color layer
 * independently, returning per-color SVG paths with hex colors.
 *
 * @throws on HTTP errors (non-2xx) or network failure.
 */
export async function convertPngMultiColorViaServer(
  pngBlob: Blob,
): Promise<ServerMultiColorResult> {
  const res = await fetch("/api/convert-png?mode=multi-color", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: pngBlob,
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error ?? `Server responded ${res.status}`);
  }

  return json as ServerMultiColorResult;
}
