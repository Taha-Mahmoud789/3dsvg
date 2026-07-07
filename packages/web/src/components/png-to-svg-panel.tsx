/**
 * PNG → SVG Vectorization Panel
 * Settings UI + live preview for the PNG-to-SVG conversion pipeline.
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wand2,
  Grid3X3,
  Palette,
  Sliders,
  Download,
  Eye,
  EyeOff,
  X,
  Loader2,
  Check,
  ChevronDown,
  Pipette,
  Bookmark,
  Trash2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type VectorMode = "smooth" | "pixel";
type ColorMode = "full" | "grayscale" | "bw";
type QualityPreset = "balanced" | "high";

interface PngToSvgPanelProps {
  file: File;
  imageUrl: string;
  isApng?: boolean;
  colorProfile?: "cmyk" | "srgb";
  onConfirm: (svg: string) => void;
  onCancel: () => void;
  onDownloadSvg?: (svg: string) => void;
}

interface Settings {
  mode: VectorMode;
  colorCount: number;
  fullColor: boolean;
  lockedColors: string[];
  colorMode: ColorMode;
  bwThreshold: number;
  smoothing: number;
  speckleSize: number;
  gridResolution: number;
  smoothEdges: boolean;
  qualityPreset: QualityPreset;
}

interface Preset {
  name: string;
  settings: Settings;
}

const DEFAULT_SETTINGS: Settings = {
  mode: "smooth",
  colorCount: 16,
  fullColor: false,
  lockedColors: [],
  colorMode: "full",
  bwThreshold: 50,
  smoothing: 60,
  speckleSize: 4,
  gridResolution: 64,
  smoothEdges: false,
  qualityPreset: "balanced",
};

const HIGH_QUALITY_PRESET: Settings = {
  ...DEFAULT_SETTINGS,
  colorCount: 128,
  smoothing: 30,
  speckleSize: 2,
  gridResolution: 128,
};

const GRID_RESOLUTIONS = [
  { value: 16, label: "16×16" },
  { value: 32, label: "32×32" },
  { value: 64, label: "64×64" },
  { value: 128, label: "128×128" },
  { value: 256, label: "256×256" },
  { value: 0, label: "Maximum Detail" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full py-2 px-1 text-xs font-medium text-foreground/80 hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PngToSvgPanel({
  file,
  imageUrl,
  isApng = false,
  colorProfile = "srgb",
  onConfirm,
  onCancel,
  onDownloadSvg,
}: PngToSvgPanelProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [resultSvg, setResultSvg] = useState<string>("");
  const [originalSize, setOriginalSize] = useState(0);
  const [svgSize, setSvgSize] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [sampleColor, setSampleColor] = useState<string | null>(null);
  const [isSampling, setIsSampling] = useState(false);
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [svgValidated, setSvgValidated] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const originalImageUrlRef = useRef<string>(imageUrl);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Load image and extract ImageData
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setImageData(data);
      setOriginalSize(file.size);
    };
    img.src = imageUrl;
  }, [imageUrl, file.size]);

  // Auto-analyze on first load
  useEffect(() => {
    if (!imageData || autoAnalyzed) return;
    setAutoAnalyzed(true);

    // Count unique colors
    const colors = new Set<string>();
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] < 128) continue;
      colors.add(`${imageData.data[i]},${imageData.data[i + 1]},${imageData.data[i + 2]}`);
    }

    // Auto-suggest settings
    const uniqueColors = colors.size;
    let suggested: Partial<Settings> = {};

    if (uniqueColors <= 8) {
      suggested = { colorCount: uniqueColors, fullColor: false, mode: "smooth" };
    } else if (uniqueColors <= 32) {
      suggested = { colorCount: Math.min(uniqueColors, 16), mode: "smooth" };
    } else {
      suggested = { colorCount: 32, mode: "smooth" };
    }

    setSettings((s) => ({ ...s, ...suggested }));
  }, [imageData, autoAnalyzed]);

  // Compute similarity score: render both original and SVG to canvas, compare pixels
  const computeSimilarity = useCallback(
    (svg: string) => {
      if (!imageData) return;
      const origCanvas = document.createElement("canvas");
      origCanvas.width = imageData.width;
      origCanvas.height = imageData.height;
      const origCtx = origCanvas.getContext("2d")!;
      origCtx.putImageData(imageData, 0, 0);

      const svgImg = new Image();
      svgImg.onload = () => {
        const svgCanvas = document.createElement("canvas");
        svgCanvas.width = imageData.width;
        svgCanvas.height = imageData.height;
        const svgCtx = svgCanvas.getContext("2d")!;
        svgCtx.drawImage(svgImg, 0, 0, imageData.width, imageData.height);

        const origPixels = origCtx.getImageData(0, 0, imageData.width, imageData.height).data;
        const svgPixels = svgCtx.getImageData(0, 0, imageData.width, imageData.height).data;

        let totalDiff = 0;
        const sampleStep = 4; // sample every 4th pixel for speed
        let sampled = 0;
        for (let i = 0; i < origPixels.length; i += 4 * sampleStep) {
          const dr = origPixels[i] - svgPixels[i];
          const dg = origPixels[i + 1] - svgPixels[i + 1];
          const db = origPixels[i + 2] - svgPixels[i + 2];
          totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
          sampled++;
        }
        const avgDiff = sampled > 0 ? totalDiff / sampled / 255 : 0;
        setSimilarityScore(Math.round((1 - avgDiff) * 100));
      };
      svgImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    },
    [imageData]
  );

  // Validate SVG renders correctly (offscreen render check)
  const validateSvgRender = useCallback((svg: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      // Timeout fallback
      setTimeout(() => resolve(false), 5000);
    });
  }, []);

  // Run vectorization in worker
  const runVectorization = useCallback(
    async (opts: Settings) => {
      if (!imageData) return;

      workerRef.current?.terminate();
      setProcessing(true);
      setProgress(0);
      setSvgValidated(false);
      setSimilarityScore(null);

      const worker = new Worker(
        new URL("../lib/png-to-svg/worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;

      worker.onmessage = async (e) => {
        const { svg, sizeBytes, isValid } = e.data;
        setResultSvg(svg);
        setSvgSize(sizeBytes);
        setProcessing(false);
        setProgress(100);
        worker.terminate();

        // Validate SVG renders correctly
        if (svg) {
          const rendersOk = await validateSvgRender(svg);
          setSvgValidated(rendersOk);
          // Compute real similarity score
          computeSimilarity(svg);
        }
      };

      worker.onerror = () => {
        setProcessing(false);
      };

      worker.postMessage({
        imageData,
        mode: opts.mode,
        isApng,
        options: {
          colorCount: opts.fullColor ? 256 : opts.colorCount,
          fullColor: opts.fullColor,
          lockedColors: opts.lockedColors,
          colorMode: opts.colorMode,
          bwThreshold: opts.bwThreshold,
          smoothing: opts.smoothing,
          speckleSize: opts.speckleSize,
          gridResolution: opts.gridResolution,
          smoothEdges: opts.smoothEdges,
        },
      });
    },
    [imageData, isApng, validateSvgRender, computeSimilarity]
  );

  // Debounced re-trace on settings change
  useEffect(() => {
    if (!imageData) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runVectorization(settings);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [settings, imageData, runVectorization]);

  // Draw preview
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

  const applyPreset = (preset: QualityPreset) => {
    if (preset === "high") {
      setSettings((s) => ({ ...s, ...HIGH_QUALITY_PRESET, mode: s.mode }));
    } else {
      setSettings((s) => ({ ...s, ...DEFAULT_SETTINGS, mode: s.mode }));
    }
    updateSetting("qualityPreset", preset);
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    setPresets((p) => [...p, { name: presetName.trim(), settings }]);
    setPresetName("");
    setShowPresetInput(false);
  };

  const deletePreset = (idx: number) => {
    setPresets((p) => p.filter((_, i) => i !== idx));
  };

  const handleEyedropper = () => {
    setIsSampling(true);
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
    setSampleColor(hex);
    setIsSampling(false);

    if (!settings.lockedColors.includes(hex)) {
      updateSetting("lockedColors", [...settings.lockedColors, hex]);
    }
  };

  const removeLockedColor = (hex: string) => {
    updateSetting(
      "lockedColors",
      settings.lockedColors.filter((c) => c !== hex)
    );
  };

  // similarityScore is computed via canvas pixel comparison in computeSimilarity()

  return (
    <div className="space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
      {/* APNG warning */}
      {isApng && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          Animated PNG detected — only the first frame will be vectorized.
        </div>
      )}

      {/* CMYK color profile warning */}
      {colorProfile === "cmyk" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          CMYK color profile detected — colors have been converted to sRGB. Some color accuracy may be lost.
        </div>
      )}

      {/* SVG validation status */}
      {resultSvg && !processing && (
        <div className={`rounded-lg border p-2 text-xs ${svgValidated ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {svgValidated ? "SVG validated — renders correctly" : "SVG validation failed — output may be malformed"}
        </div>
      )}

      {/* Mode selector */}
      <div className="flex rounded-lg border border-white/[0.06] overflow-hidden">
        <button
          onClick={() => updateSetting("mode", "smooth")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium transition-colors ${
            settings.mode === "smooth"
              ? "bg-primary text-primary-foreground"
              : "bg-background/50 text-muted-foreground hover:text-foreground"
          }`}
          aria-label="Smooth Trace mode"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Smooth Trace
        </button>
        <button
          onClick={() => updateSetting("mode", "pixel")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium transition-colors ${
            settings.mode === "pixel"
              ? "bg-primary text-primary-foreground"
              : "bg-background/50 text-muted-foreground hover:text-foreground"
          }`}
          aria-label="Pixel Grid mode"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          Pixel Grid
        </button>
      </div>

      {/* Quality preset */}
      <div className="flex gap-2">
        <Button
          variant={settings.qualityPreset === "balanced" ? "default" : "outline"}
          size="sm"
          className="flex-1 text-xs"
          onClick={() => applyPreset("balanced")}
          aria-label="Balanced quality preset"
        >
          Balanced
        </Button>
        <Button
          variant={settings.qualityPreset === "high" ? "default" : "outline"}
          size="sm"
          className="flex-1 text-xs"
          onClick={() => applyPreset("high")}
          aria-label="High quality preset — larger file, more detail"
        >
          <Sparkles className="h-3 w-3 mr-1" />
          High Quality
        </Button>
      </div>

      {/* Preview */}
      <div className="relative rounded-lg border border-white/[0.06] overflow-hidden bg-white/5">
        <canvas
          ref={previewCanvasRef}
          className={`w-full aspect-square object-contain ${isSampling ? "cursor-crosshair" : ""}`}
          onClick={handlePreviewClick}
          aria-label="Vectorized SVG preview"
          role="img"
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
                aria-label={showOriginal ? "Show traced result" : "Show original image"}
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

      {/* Eyedropper */}
      <div className="flex items-center gap-2">
        <Button
          variant={isSampling ? "default" : "outline"}
          size="sm"
          className="text-xs"
          onClick={handleEyedropper}
          aria-label={isSampling ? "Click on preview to sample color" : "Activate eyedropper to lock a brand color"}
        >
          <Pipette className="h-3 w-3 mr-1" />
          {isSampling ? "Click on preview..." : "Eyedropper"}
        </Button>
        {settings.lockedColors.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {settings.lockedColors.map((hex) => (
              <div key={hex} className="flex items-center gap-1">
                <div
                  className="w-4 h-4 rounded border border-white/20"
                  style={{ backgroundColor: hex }}
                />
                <button
                  onClick={() => removeLockedColor(hex)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove locked color ${hex}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings sections */}
      <Section title="Colors" icon={Palette}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Full Color</Label>
            <Switch
              checked={settings.fullColor}
              onCheckedChange={(v) => updateSetting("fullColor", v)}
              aria-label="Full color mode"
            />
          </div>
          {!settings.fullColor && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Colors: {settings.colorCount}</Label>
              </div>
              <Slider
                value={[settings.colorCount]}
                onValueChange={(v) => updateSetting("colorCount", v[0])}
                min={2}
                max={256}
                step={1}
                aria-label="Color count"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Color Mode</Label>
            <div className="flex gap-1">
              {(["full", "grayscale", "bw"] as ColorMode[]).map((m) => (
                <Button
                  key={m}
                  variant={settings.colorMode === m ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs capitalize"
                  onClick={() => updateSetting("colorMode", m)}
                  aria-label={`${m === "bw" ? "Black and white" : m} color mode`}
                >
                  {m === "bw" ? "B&W" : m}
                </Button>
              ))}
            </div>
          </div>
          {settings.colorMode === "bw" && (
            <div className="space-y-1">
              <Label className="text-xs">Threshold: {settings.bwThreshold}%</Label>
              <Slider
                value={[settings.bwThreshold]}
                onValueChange={(v) => updateSetting("bwThreshold", v[0])}
                min={0}
                max={100}
                step={1}
                aria-label="Black and white threshold"
              />
            </div>
          )}
        </div>
      </Section>

      {/* Mode-specific settings */}
      {settings.mode === "smooth" ? (
        <Section title="Smooth Trace" icon={Wand2}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Sharp ↔ Smooth: {settings.smoothing}%
              </Label>
              <Slider
                value={[settings.smoothing]}
                onValueChange={(v) => updateSetting("smoothing", v[0])}
                min={0}
                max={100}
                step={1}
                aria-label="Smoothing level"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Min Detail Size: {settings.speckleSize}px
              </Label>
              <Slider
                value={[settings.speckleSize]}
                onValueChange={(v) => updateSetting("speckleSize", v[0])}
                min={0}
                max={20}
                step={1}
                aria-label="Minimum detail size"
              />
            </div>
          </div>
        </Section>
      ) : (
        <Section title="Pixel Grid" icon={Grid3X3}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Grid Resolution</Label>
              <div className="grid grid-cols-3 gap-1">
                {GRID_RESOLUTIONS.map((res) => (
                  <Button
                    key={res.value}
                    variant={settings.gridResolution === res.value ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => updateSetting("gridResolution", res.value)}
                    aria-label={`Grid resolution ${res.label}`}
                  >
                    {res.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Smooth Edges</Label>
              <Switch
                checked={settings.smoothEdges}
                onCheckedChange={(v) => updateSetting("smoothEdges", v)}
                aria-label="Smooth edges"
              />
            </div>
          </div>
        </Section>
      )}

      {/* File size readout */}
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

      {/* Presets */}
      <Section title="Presets" icon={Bookmark} defaultOpen={false}>
        <div className="space-y-2">
          {presets.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs justify-start"
                onClick={() => setSettings(p.settings)}
              >
                {p.name}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => deletePreset(i)}
                aria-label={`Delete preset ${p.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {showPresetInput ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name..."
                className="flex-1 rounded-md border border-input bg-background/50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => e.key === "Enter" && savePreset()}
                autoFocus
              />
              <Button size="sm" onClick={savePreset}>
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs w-full"
              onClick={() => setShowPresetInput(true)}
              aria-label="Save current settings as a named preset"
            >
              Save Current Settings
            </Button>
          )}
        </div>
      </Section>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={onCancel}
          aria-label="Cancel vectorization and close panel"
        >
          Cancel
        </Button>
        {onDownloadSvg && resultSvg && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onDownloadSvg(resultSvg)}
            aria-label="Download SVG file"
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
          aria-label="Send vectorized SVG to the 3D editor"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          Continue to 3D
        </Button>
      </div>
    </div>
  );
}
