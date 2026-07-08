/**
 * Server-side PNG → SVG conversion endpoint.
 *
 * Accepts a raw PNG buffer via POST, runs it through the sharp + potrace
 * vectorization bridge, and returns the optimised SVG string.  This keeps
 * the Node.js-native dependencies (sharp, potrace) completely isolated from
 * the browser bundle — the engine package stays framework-agnostic.
 *
 * @packageDocumentation
 */

import { NextRequest, NextResponse } from "next/server";
import {
  convertPngToSvg,
  convertPngToMultiColorSvg,
} from "@/lib/png-to-svg/convert-png-to-svg";

/* ---- Config ---- */

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

/* ---- POST /api/convert-png ---- */

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Payload too large — max ${MAX_BODY_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  let pngBuffer: Buffer;
  try {
    const arrayBuffer = await req.arrayBuffer();
    pngBuffer = Buffer.from(arrayBuffer);
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body as binary" },
      { status: 400 },
    );
  }

  if (pngBuffer.length === 0) {
    return NextResponse.json(
      { error: "Empty body — send a PNG buffer" },
      { status: 400 },
    );
  }

  // Validate PNG magic bytes (‰PNG)
  const magic = pngBuffer.subarray(0, 8);
  const isPng =
    magic[0] === 0x89 &&
    magic[1] === 0x50 && // P
    magic[2] === 0x4e && // N
    magic[3] === 0x47; // G
  if (!isPng) {
    return NextResponse.json(
      { error: "Not a valid PNG — magic bytes mismatch" },
      { status: 422 },
    );
  }

  try {
    const mode = req.nextUrl.searchParams.get("mode");

    if (mode === "multi-color") {
      const result = await convertPngToMultiColorSvg(pngBuffer);
      return NextResponse.json({
        mode: "multi-color",
        layers: result.layers,
        composite: result.composite,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
        palette: result.palette,
        originalBytes: pngBuffer.length,
      });
    }

    const { svg, sizeBytes } = await convertPngToSvg(pngBuffer);

    return NextResponse.json({
      svg,
      sizeBytes,
      originalBytes: pngBuffer.length,
    });
  } catch (err) {
    console.error("[api/convert-png] vectorization failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
