/**
 * =============================================================================
 * Controls Panel
 * =============================================================================
 *
 * Settings sidebar with collapsible accordion sections for Object, Position,
 * Background, Material, Texture, Animation, Interaction, and Lighting.
 * Rendered as a floating glassmorphic panel over the 3D canvas.
 */

"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  type TextureSettings,
  type MaterialSettings,
  type MaterialPreset,
  materialPresets,
} from "@/lib/types";
import { texturePresets } from "@/lib/procedural-textures";
import {
  ChevronDown,
  Upload,
  Eraser,
  Box,
  Palette,
  Image,
  Play,
  MousePointer,
  Sun,
  Move3d,
  Paintbrush,
  Pencil,
  RotateCcw,
  X,
  type LucideIcon,
} from "lucide-react";
import { type LightSettings } from "@/components/svg-to-3d-canvas";
import type { AnimationType } from "3dsvg";

interface ControlsPanelProps {
  depth: number;
  onDepthChange: (v: number) => void;
  smoothness: number;
  onSmoothnessChange: (v: number) => void;
  color: string;
  onColorChange: (v: string) => void;
  bgColor: string;
  onBgColorChange: (v: string) => void;
  textureUrl: string | null;
  onTextureUpload: (url: string | null) => void;
  textureSettings: TextureSettings;
  onTextureSettingsChange: (s: TextureSettings) => void;
  materialSettings: MaterialSettings;
  onMaterialSettingsChange: (s: MaterialSettings) => void;
  animate: AnimationType;
  onAnimateChange: (v: AnimationType) => void;
  animateSpeed: number;
  onAnimateSpeedChange: (v: number) => void;
  animateReverse: boolean;
  onAnimateReverseChange: (v: boolean) => void;
  lightSettings: LightSettings;
  onLightSettingsChange: (s: LightSettings) => void;
  cursorOrbit: boolean;
  onCursorOrbitChange: (v: boolean) => void;
  orbitStrength: number;
  onOrbitStrengthChange: (v: number) => void;
  resetOnIdle: boolean;
  onResetOnIdleChange: (v: boolean) => void;
  resetDelay: number;
  onResetDelayChange: (v: number) => void;
  rotationX: number;
  onRotationXChange: (v: number) => void;
  rotationY: number;
  onRotationYChange: (v: number) => void;
  zoom: number;
  onZoomChange: (v: number) => void;
  onReset: () => void;
  onClose: () => void;
  onLightingSectionChange?: (open: boolean) => void;
}

const COLOR_PRESETS = [
  { hex: "#000000", name: "Black" },
  { hex: "#ef4444", name: "Red" },
  { hex: "#f97316", name: "Orange" },
  { hex: "#eab308", name: "Yellow" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#06b6d4", name: "Cyan" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#8b5cf6", name: "Purple" },
  { hex: "#ec4899", name: "Pink" },
  { hex: "#ffffff", name: "White" },
];

const MATERIAL_PRESET_NAMES: Record<MaterialPreset, string> = {
  default: "Default",
  plastic: "Plastic",
  metal: "Metal",
  glass: "Glass",
  rubber: "Rubber",
  chrome: "Chrome",
  gold: "Gold",
  clay: "Clay",
  emissive: "Emissive",
  holographic: "Holographic",
};

const ANIMATION_OPTIONS: { value: AnimationType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "spin", label: "Spin" },
  { value: "float", label: "Float" },
  { value: "pulse", label: "Pulse" },
  { value: "wobble", label: "Wobble" },
  { value: "swing", label: "Swing" },
  { value: "spinFloat", label: "Spin + Float" },
];

// ---------------------------------------------------------------------------
// Collapsible Section component
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  open,
  onToggle,
  onOpenChange,
  children,
}: {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const toggle = () => {
    onToggle();
    onOpenChange?.(!open);
  };

  return (
    <div className="border-b border-white/[0.06]">
      <button
        onClick={toggle}
        className={`flex w-full items-center gap-2 py-3 px-4 cursor-pointer transition-colors ${open ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"}`}
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1 text-left">{title}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pt-4 pb-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Commit-based number input — shows prop value, only pushes on blur/Enter
function CommitNumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Sync display when prop changes (from engine) but not while editing
  useEffect(() => {
    if (!focused) setLocal(String(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = parseFloat(local);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
      onCommit(clamped);
      setLocal(String(clamped));
    } else {
      setLocal(String(value));
    }
  };

  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      min={min}
      max={max}
      step={step}
      className={className ?? "w-16 h-7 rounded-md border border-input bg-background/50 px-2 text-xs font-mono text-center"}
    />
  );
}

// ---------------------------------------------------------------------------
// ControlsPanel
// ---------------------------------------------------------------------------

export function ControlsPanel({
  depth,
  onDepthChange,
  smoothness,
  onSmoothnessChange,
  color,
  onColorChange,
  bgColor,
  onBgColorChange,
  textureUrl,
  onTextureUpload,
  textureSettings,
  onTextureSettingsChange,
  materialSettings,
  onMaterialSettingsChange,
  animate,
  onAnimateChange,
  animateSpeed,
  onAnimateSpeedChange,
  animateReverse,
  onAnimateReverseChange,
  lightSettings,
  onLightSettingsChange,
  cursorOrbit,
  onCursorOrbitChange,
  orbitStrength,
  onOrbitStrengthChange,
  resetOnIdle,
  onResetOnIdleChange,
  resetDelay,
  onResetDelayChange,
  rotationX,
  onRotationXChange,
  rotationY,
  onRotationYChange,
  zoom,
  onZoomChange,
  onReset,
  onClose,
  onLightingSectionChange,
}: ControlsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>("object");
  const toggleSection = (name: string) => setOpenSection((prev) => prev === name ? null : name);

  const handleTextureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      onTextureUpload(url);
    }
  };

  const updateTexture = (partial: Partial<TextureSettings>) => {
    onTextureSettingsChange({ ...textureSettings, ...partial });
  };

  return (
    <div className="w-72 max-md:w-full rounded-xl bg-card/70 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_oklch(0_0_0/0.5),0_0_20px_oklch(0.78_0.15_195/0.06)] h-full flex flex-col overflow-hidden">
      {/* Header -- fixed at top */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Settings</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-none">
      {/* 1. Object */}
      <Section icon={Box} title="Object" open={openSection === "object"} onToggle={() => toggleSection("object")}>
        <div className="space-y-2">
          <div className="relative flex items-center gap-2 h-8 rounded-md border border-input bg-background/30 px-2 cursor-pointer overflow-hidden">
            <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="h-4 w-4 rounded-sm border border-white/10 shrink-0" style={{ backgroundColor: color }} />
            <span className="text-xs font-mono text-muted-foreground">{color}</span>
          </div>
          <div className="flex gap-1.5">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                className={`h-5 w-5 rounded-full border border-white/10 transition-transform hover:scale-110 ${color.toLowerCase() === preset.hex.toLowerCase() ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                style={{ backgroundColor: preset.hex }}
                onClick={() => onColorChange(preset.hex)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Depth</Label>
            <span className="text-xs text-muted-foreground font-mono">{depth.toFixed(1)}</span>
          </div>
          <Slider value={[depth]} onValueChange={([v]) => onDepthChange(v)} min={0.5} max={10} step={0.1} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Smoothness</Label>
            <span className="text-xs text-muted-foreground font-mono">{(smoothness * 100).toFixed(0)}%</span>
          </div>
          <Slider value={[smoothness]} onValueChange={([v]) => onSmoothnessChange(v)} min={0} max={1} step={0.05} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Zoom</Label>
            <span className="text-xs text-muted-foreground font-mono">{zoom.toFixed(1)}</span>
          </div>
          <Slider value={[zoom]} onValueChange={([v]) => onZoomChange(v)} min={2} max={20} step={0.5} />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 w-full"
          onClick={() => {
            onRotationXChange(0);
            onRotationYChange(0);
            onZoomChange(8);
            onReset();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Position
        </Button>
      </Section>

      {/* 2. Background */}
      <Section icon={Paintbrush} title="Background" open={openSection === "background"} onToggle={() => toggleSection("background")}>
        <div className="space-y-2">
          <div className="relative flex items-center gap-2 h-8 rounded-md border border-input bg-background/30 px-2 cursor-pointer overflow-hidden">
            <input type="color" value={bgColor} onChange={(e) => onBgColorChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="h-4 w-4 rounded-sm border border-white/10 shrink-0" style={{ backgroundColor: bgColor }} />
            <span className="text-xs font-mono text-muted-foreground">{bgColor}</span>
          </div>
          <div className="flex gap-1.5">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={`bg-${preset.hex}`}
                className={`h-5 w-5 rounded-full border border-white/10 transition-transform hover:scale-110 ${bgColor.toLowerCase() === preset.hex.toLowerCase() ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                style={{ backgroundColor: preset.hex }}
                onClick={() => onBgColorChange(preset.hex)}
              />
            ))}
          </div>
        </div>
      </Section>

      {/* 4. Material */}
      <Section icon={Palette} title="Material" open={openSection === "material"} onToggle={() => toggleSection("material")}>
        <div className="space-y-2">
          <select
            value={materialSettings.preset}
            onChange={(e) => {
              const key = e.target.value as MaterialPreset;
              const p = materialPresets[key];
              onMaterialSettingsChange({
                ...materialSettings,
                preset: key,
                metalness: p.metalness,
                roughness: p.roughness,
                opacity: p.opacity,
                transparent: p.transparent,
              });
            }}
            className="w-full h-8 rounded-md border border-input bg-background/30 px-3 pr-8 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
          >
            {(Object.keys(materialPresets) as MaterialPreset[]).map((key) => (
              <option key={key} value={key}>
                {MATERIAL_PRESET_NAMES[key]}
              </option>
            ))}
          </select>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-0" : "-rotate-90"}`} />
            Advanced
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs">Metalness</Label>
                <span className="text-xs text-muted-foreground font-mono">{materialSettings.metalness.toFixed(2)}</span>
              </div>
              <Slider value={[materialSettings.metalness]} onValueChange={([v]) => onMaterialSettingsChange({ ...materialSettings, metalness: v })} min={0} max={1} step={0.01} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs">Roughness</Label>
                <span className="text-xs text-muted-foreground font-mono">{materialSettings.roughness.toFixed(2)}</span>
              </div>
              <Slider value={[materialSettings.roughness]} onValueChange={([v]) => onMaterialSettingsChange({ ...materialSettings, roughness: v })} min={0} max={1} step={0.01} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs">Opacity</Label>
                <span className="text-xs text-muted-foreground font-mono">{materialSettings.opacity.toFixed(2)}</span>
              </div>
              <Slider value={[materialSettings.opacity]} onValueChange={([v]) => onMaterialSettingsChange({ ...materialSettings, opacity: v, transparent: v < 1 })} min={0} max={1} step={0.01} />
            </div>
            <div className="flex items-center justify-between pt-1">
              <Label htmlFor="wireframe" className="text-xs cursor-pointer">Wireframe</Label>
              <Switch id="wireframe" checked={materialSettings.wireframe} onCheckedChange={(checked) => onMaterialSettingsChange({ ...materialSettings, wireframe: checked })} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Section>

      {/* 5. Texture */}
      <Section icon={Image} title="Texture" open={openSection === "texture"} onToggle={() => toggleSection("texture")}>
        <div className="space-y-2">
          <TexturePresetPicker activeUrl={textureUrl} onSelect={onTextureUpload} />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            Upload
          </Button>
          {textureUrl && (
            <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => onTextureUpload(null)}>
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleTextureUpload} />

        {textureUrl && (
          <Collapsible open={transformOpen} onOpenChange={setTransformOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${transformOpen ? "rotate-0" : "-rotate-90"}`} />
              Transform
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              {[
                { label: "Repeat X", key: "repeatX" as const, min: 0.1, max: 5, step: 0.05, format: (v: number) => `${v.toFixed(2)}x` },
                { label: "Repeat Y", key: "repeatY" as const, min: 0.1, max: 5, step: 0.05, format: (v: number) => `${v.toFixed(2)}x` },
                { label: "Rotation", key: "rotation" as const, min: -Math.PI, max: Math.PI, step: 0.01, format: (v: number) => `${((v * 180) / Math.PI).toFixed(0)}\u00B0` },
                { label: "Offset X", key: "offsetX" as const, min: -2, max: 2, step: 0.01, format: (v: number) => v.toFixed(2) },
                { label: "Offset Y", key: "offsetY" as const, min: -2, max: 2, step: 0.01, format: (v: number) => v.toFixed(2) },
              ].map(({ label, key, min, max, step, format }) => (
                <div key={key} className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs">{label}</Label>
                    <span className="text-xs text-muted-foreground font-mono">{format(textureSettings[key])}</span>
                  </div>
                  <Slider value={[textureSettings[key]]} onValueChange={([v]) => updateTexture({ [key]: v })} min={min} max={max} step={step} />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </Section>

      {/* 6. Animation */}
      <Section icon={Play} title="Animation" open={openSection === "animation"} onToggle={() => toggleSection("animation")}>
        <div className="space-y-2">
          <select
            value={animate}
            onChange={(e) => onAnimateChange(e.target.value as AnimationType)}
            className="w-full h-8 rounded-md border border-input bg-background/30 px-3 pr-8 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring appearance-none bg-no-repeat bg-[right_8px_center] bg-[length:12px]"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }}
          >
            {ANIMATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {animate !== "none" && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Speed</Label>
                <span className="text-xs text-muted-foreground font-mono">{animateSpeed.toFixed(1)}x</span>
              </div>
              <Slider value={[animateSpeed]} onValueChange={([v]) => onAnimateSpeedChange(v)} min={0.1} max={5} step={0.1} />
            </div>

            {(animate === "spin" || animate === "spinFloat" || animate === "wobble" || animate === "swing") && (
              <div className="flex items-center justify-between">
                <Label htmlFor="reverse" className="text-xs cursor-pointer">Reverse Direction</Label>
                <Switch id="reverse" checked={animateReverse} onCheckedChange={onAnimateReverseChange} />
              </div>
            )}
          </>
        )}
      </Section>

      {/* 7. Interaction */}
      <Section icon={MousePointer} title="Interaction" open={openSection === "interaction"} onToggle={() => toggleSection("interaction")}>
        <div className="flex items-center justify-between">
          <Label htmlFor="cursor-orbit" className="text-xs cursor-pointer">Follow Cursor</Label>
          <Switch id="cursor-orbit" checked={cursorOrbit} onCheckedChange={onCursorOrbitChange} />
        </div>
        {cursorOrbit && (
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Strength</Label>
              <span className="text-xs text-muted-foreground font-mono">{orbitStrength.toFixed(2)}</span>
            </div>
            <Slider value={[orbitStrength]} onValueChange={([v]) => onOrbitStrengthChange(v)} min={0.01} max={0.5} step={0.01} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <Label htmlFor="reset-idle" className="text-xs cursor-pointer">Reset on Idle</Label>
          <Switch id="reset-idle" checked={resetOnIdle} onCheckedChange={onResetOnIdleChange} />
        </div>
        {resetOnIdle && (
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Delay</Label>
              <span className="text-xs text-muted-foreground font-mono">{resetDelay.toFixed(1)}s</span>
            </div>
            <Slider value={[resetDelay]} onValueChange={([v]) => onResetDelayChange(v)} min={0.5} max={10} step={0.5} />
          </div>
        )}
      </Section>

      {/* 8. Lighting */}
      <Section icon={Sun} title="Lighting" open={openSection === "lighting"} onToggle={() => toggleSection("lighting")} onOpenChange={onLightingSectionChange}>
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Key Light X</Label>
            <span className="text-xs text-muted-foreground font-mono">{lightSettings.keyX.toFixed(1)}</span>
          </div>
          <Slider value={[lightSettings.keyX]} onValueChange={([v]) => onLightSettingsChange({ ...lightSettings, keyX: v })} min={-10} max={10} step={0.5} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Key Light Y</Label>
            <span className="text-xs text-muted-foreground font-mono">{lightSettings.keyY.toFixed(1)}</span>
          </div>
          <Slider value={[lightSettings.keyY]} onValueChange={([v]) => onLightSettingsChange({ ...lightSettings, keyY: v })} min={-10} max={10} step={0.5} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Key Light Z</Label>
            <span className="text-xs text-muted-foreground font-mono">{lightSettings.keyZ.toFixed(1)}</span>
          </div>
          <Slider value={[lightSettings.keyZ]} onValueChange={([v]) => onLightSettingsChange({ ...lightSettings, keyZ: v })} min={-10} max={10} step={0.5} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Key Intensity</Label>
            <span className="text-xs text-muted-foreground font-mono">{lightSettings.keyIntensity.toFixed(1)}</span>
          </div>
          <Slider value={[lightSettings.keyIntensity]} onValueChange={([v]) => onLightSettingsChange({ ...lightSettings, keyIntensity: v })} min={0} max={5} step={0.1} />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-xs font-medium text-muted-foreground">Ambient</Label>
            <span className="text-xs text-muted-foreground font-mono">{lightSettings.ambientIntensity.toFixed(2)}</span>
          </div>
          <Slider value={[lightSettings.ambientIntensity]} onValueChange={([v]) => onLightSettingsChange({ ...lightSettings, ambientIntensity: v })} min={0} max={2} step={0.05} />
        </div>

        <div className="flex items-center justify-between pt-1">
          <Label htmlFor="shadow" className="text-xs cursor-pointer">Shadows</Label>
          <Switch id="shadow" checked={lightSettings.shadowEnabled} onCheckedChange={(checked) => onLightSettingsChange({ ...lightSettings, shadowEnabled: checked })} />
        </div>
      </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TexturePresetPicker -- grid of procedural texture thumbnails
// ---------------------------------------------------------------------------

function TexturePresetPicker({
  activeUrl,
  onSelect,
}: {
  activeUrl: string | null;
  onSelect: (url: string | null) => void;
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selectedName, setSelectedName] = useState<string | null>(null);

  useEffect(() => {
    const generated: Record<string, string> = {};
    texturePresets.forEach((preset) => {
      generated[preset.name] = preset.generate();
    });
    setPreviews(generated);
  }, []);

  return (
    <div className="flex flex-wrap gap-2">
      {texturePresets.map((preset) => {
        const previewUrl = previews[preset.name];
        const isActive = selectedName === preset.name && activeUrl === previewUrl;
        return (
          <Tooltip key={preset.name}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (!previewUrl) return;
                  if (isActive) {
                    setSelectedName(null);
                    onSelect(null);
                  } else {
                    setSelectedName(preset.name);
                    onSelect(previewUrl);
                  }
                }}
                className={`h-10 w-10 rounded-full overflow-hidden border border-white/10 transition-all hover:scale-110 ${isActive ? "ring-2 ring-primary" : ""} ${!previewUrl ? "bg-muted animate-pulse" : ""}`}
              >
                {previewUrl && <img src={previewUrl} alt={preset.name} className="h-full w-full object-cover" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{preset.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
