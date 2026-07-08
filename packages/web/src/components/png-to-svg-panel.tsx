"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Loader2,
  Eye,
  EyeOff,
  Download,
  X,
  Check,
  Pipette,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { ConvertSettings } from "@/lib/png-to-svg/types";

type ColorMode = "full" | "grayscale" | "bw";
type QualityPreset = "balanced" | "high";

interface PngToSvgPanelProps {
  file: File;
  imageUrl: string;
  onConfirm: (svg: string) => void;
  onCancel: () => void;
  onDownloadSvg?: (svg: string) => void;
}

interface Settings {
  colorMode: ColorMode;
  colorCount: number;
  qualityPreset: QualityPreset;
  smoothing: number;
  speckleSize: number;
}

const DEFAULT_SETTINGS: Settings = {
  colorMode: "full",
  colorCount: 16,
  qualityPreset: "balanced",
  smoothing: 60,
  speckleSize: 4,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function PngToSvgPanel({
  file,
  imageUrl,
  onConfirm,
  onCancel,
  onDownloadSvg,
}: PngToSvgPanelProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [resultSvg, setResultSvg] = useState("");
  const [originalSize, setOriginalSize] = useState(0);
  const [svgSize, setSvgSize] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [svgValidated, setSvgValidated] = useState(false);
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [isSampling, setIsSampling] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageUrlRef = useRef(imageUrl);
  const imageDataRef = useRef<ImageData | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      imageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setOriginalSize(file.size);
    };
    img.src = imageUrl;
  }, [imageUrl, file.size]);

  const computeSimilarity = useCallback((svg: string) => {
    const imageData = imageDataRef.current;
    if (!imageData) return;
    const svgImg = new Image();
    svgImg.onload = () => {
      const svgCanvas = document.createElement("canvas");
      svgCanvas.width = imageData.width;
      svgCanvas.height = imageData.height;
      const svgCtx = svgCanvas.getContext("2d")!;
      svgCtx.drawImage(svgImg, 0, 0, imageData.width, imageData.height);
      const svgPixels = svgCtx.getImageData(0, 0, imageData.width, imageData.height).data;
      const origPixels = imageData.data;
      let totalDiff = 0;
      let sampled = 0;
      for (let i = 0; i < origPixels.length; i += 16) {
        const dr = origPixels[i] - svgPixels[i];
        const dg = origPixels[i + 1] - svgPixels[i + 1];
        const db = origPixels[i + 2] - svgPixels[i + 2];
        totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
        sampled++;
      }
      const maxDist = 255 * Math.sqrt(3);
      const avgDiff = sampled > 0 ? totalDiff / sampled / maxDist : 0;
      setSimilarityScore(Math.round((1 - avgDiff) * 100));
    };
    svgImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, []);

  const validateSvg = useCallback((svg: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, "image/svg+xml");
      const parseError = doc.querySelector("parsererror");
      if (parseError) {
        resolve(false);
        return;
      }
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      setTimeout(() => resolve(false), 5000);
    });
  }, []);

  const runConversion = useCallback(async (opts: Settings) => {
    setProcessing(true);
    setTraceError(null);
    setResultSvg("");
    setSvgValidated(false);
    setSimilarityScore(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append(
        "settings",
        JSON.stringify({
          colorMode: opts.colorMode,
          colorCount: opts.colorCount,
          qualityPreset: opts.qualityPreset,
          smoothing: opts.smoothing,
          speckleSize: opts.speckleSize,
        } satisfies ConvertSettings),
      );

      const res = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setTraceError(data.error || "Conversion failed");
        setProcessing(false);
        return;
      }

      const { svg, sizeBytes } = data;
      setResultSvg(svg);
      setSvgSize(sizeBytes);
      setProcessing(false);

      if (svg) {
        const isValid = await validateSvg(svg);
        setSvgValidated(isValid);
        computeSimilarity(svg);
      }
    } catch (err) {
      setTraceError(err instanceof Error ? err.message : "Conversion failed");
      setProcessing(false);
    }
  }, [file, validateSvg, computeSimilarity]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runConversion(settings);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [settings, runConversion]);

  useEffect(() => {
    if (!previewCanvasRef.current || !resultSvg) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resultSvg)}`;
  }, [resultSvg]);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSampling || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    const ctx = canvas.getContext("2d")!;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
    setIsSampling(false);
  };

  return (
    <div className="space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
      {traceError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {traceError}
        </div>
      )}

      {resultSvg && !processing && (
        <div className={`rounded-lg border p-2 text-xs ${svgValidated ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {svgValidated ? "SVG validated" : "SVG validation failed"}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant={settings.qualityPreset === "balanced" ? "default" : "outline"}
          size="sm"
          className="flex-1 text-xs"
          onClick={() => updateSetting("qualityPreset", "balanced")}
        >
          Balanced
        </Button>
        <Button
          variant={settings.qualityPreset === "high" ? "default" : "outline"}
          size="sm"
          className="flex-1 text-xs"
          onClick={() => updateSetting("qualityPreset", "high")}
        >
          High Quality
        </Button>
      </div>

      <div className="relative rounded-lg border border-white/[0.06] overflow-hidden bg-white/5">
        <canvas
          ref={previewCanvasRef}
          className={`w-full aspect-square object-contain ${isSampling ? "cursor-crosshair" : ""}`}
          onClick={handlePreviewClick}
        />
        {processing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 bg-background/60 backdrop-blur-sm"
                onClick={() => setShowOriginal(!showOriginal)}
              >
                {showOriginal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showOriginal ? "Show traced" : "Show original"}</TooltipContent>
          </Tooltip>
        </div>
        {showOriginal && (
          <img
            src={originalImageUrlRef.current}
            alt="Original"
            className="absolute inset-0 w-full h-full object-contain"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={isSampling ? "default" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setIsSampling(!isSampling)}
        >
          <Pipette className="h-3 w-3 mr-1" />
          {isSampling ? "Click preview..." : "Eyedropper"}
        </Button>
      </div>

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors">
          <span className="flex items-center gap-2">
            <Wand2 className="h-3.5 w-3.5" />
            Color Mode
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-3 space-y-3">
          <div className="flex gap-1">
            {(["full", "grayscale", "bw"] as ColorMode[]).map((m) => (
              <Button
                key={m}
                variant={settings.colorMode === m ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs capitalize"
                onClick={() => updateSetting("colorMode", m)}
              >
                {m === "bw" ? "B&W" : m}
              </Button>
            ))}
          </div>

          {settings.colorMode === "full" && (
            <div className="space-y-1">
              <Label className="text-xs">Colors: {settings.colorCount}</Label>
              <Slider
                value={[settings.colorCount]}
                onValueChange={(v) => updateSetting("colorCount", v[0])}
                min={2}
                max={256}
                step={1}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Sharp ↔ Smooth: {settings.smoothing}%</Label>
            <Slider
              value={[settings.smoothing]}
              onValueChange={(v) => updateSetting("smoothing", v[0])}
              min={0}
              max={100}
              step={1}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Min Detail Size: {settings.speckleSize}px</Label>
            <Slider
              value={[settings.speckleSize]}
              onValueChange={(v) => updateSetting("speckleSize", v[0])}
              min={0}
              max={20}
              step={1}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="rounded-lg border border-white/[0.06] p-3 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Original PNG:</span>
          <span className="font-mono">{formatBytes(originalSize)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Optimized SVG:</span>
          <span className="font-mono text-primary">{formatBytes(svgSize)}</span>
        </div>
        {similarityScore !== null && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Similarity:</span>
            <span className="font-mono">{similarityScore}%</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        {onDownloadSvg && resultSvg && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onDownloadSvg(resultSvg)}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            SVG
          </Button>
        )}
        <Button
          size="sm"
          className="flex-1 text-xs"
          onClick={() => onConfirm(resultSvg)}
          disabled={!resultSvg || processing}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Continue to 3D
        </Button>
      </div>
    </div>
  );
}
