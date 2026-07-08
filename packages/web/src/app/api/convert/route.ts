import { NextRequest, NextResponse } from "next/server";
import { convertPngToSvg } from "@/lib/png-to-svg/convert";
import type { ConvertSettings } from "@/lib/png-to-svg/types";

const DEFAULT_SETTINGS: ConvertSettings = {
  colorMode: "full",
  colorCount: 16,
  qualityPreset: "balanced",
  smoothing: 60,
  speckleSize: 4,
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const settingsStr = formData.get("settings") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10 MB)" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const settings: ConvertSettings = {
      ...DEFAULT_SETTINGS,
      ...(settingsStr ? JSON.parse(settingsStr) : {}),
    };

    const result = await convertPngToSvg(buffer, settings);

    return NextResponse.json({
      svg: result.svg,
      sizeBytes: result.sizeBytes,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Conversion failed" },
      { status: 500 },
    );
  }
}
