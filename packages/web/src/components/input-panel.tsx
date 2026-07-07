/**
 * =============================================================================
 * Input Panel
 * =============================================================================
 *
 * Vertical toolbar (top-left) + expandable content panel. Each tool produces
 * an SVG string fed to the 3D canvas.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Pencil,
  Type,
  FileUp,
  Upload,
  Code,
  FileCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { PixelEditor } from "@/components/pixel-editor";
import { TextInput } from "@/components/text-input";
import { PngToSvgPanel } from "@/components/png-to-svg-panel";

const RASTER_TYPES = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
const RASTER_MIME = /^image\/(png|jpe?g|gif|webp|bmp|x-icon)$/;

function isRasterFile(file: File): boolean {
  if (RASTER_MIME.test(file.type)) return true;
  return RASTER_TYPES.test(file.name);
}

function validateImageMagicBytes(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 16));
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  // WebP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;
  return false;
}

/**
 * Detect APNG by scanning for the acTL (animation control) chunk
 * in the PNG binary data. Returns true if the PNG has an acTL chunk
 * before the first IDAT chunk.
 */
function detectApng(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  // PNG signature is 8 bytes, then chunks start
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const chunkType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (chunkType === "acTL") return true;
    if (chunkType === "IDAT") return false; // IDAT before acTL = not animated
    offset += 12 + chunkLen; // 4 len + 4 type + 4 crc + chunkLen
  }
  return false;
}

/**
 * Detect ICC/CMYK color profiles in PNG binary data.
 * Returns 'cmyk' if cHRM or iCCP with CMYK intent is found, 'srgb' otherwise.
 * Browser canvas automatically converts to sRGB, but CMYK PNGs may lose color
 * accuracy during that conversion, so we warn the user.
 */
function detectColorProfile(buffer: ArrayBuffer): "cmyk" | "srgb" {
  const bytes = new Uint8Array(buffer);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const chunkLen = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const chunkType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (chunkType === "iCCP") {
      // iCCP chunk: check if profile name contains "CMYK"
      const nameStart = offset + 8;
      let nameEnd = nameStart;
      while (nameEnd < offset + 8 + chunkLen && bytes[nameEnd] !== 0) nameEnd++;
      const name = String.fromCharCode(...bytes.slice(nameStart, nameEnd));
      if (name.toLowerCase().includes("cmyk")) return "cmyk";
    }
    if (chunkType === "sRGB") return "srgb";
    if (chunkType === "IDAT") break; // stop after data starts
    offset += 12 + chunkLen;
  }
  return "srgb";
}

interface InputPanelProps {
  inputTab: string;
  onInputTabChange: (tab: string) => void;
  customSvg: string;
  onCustomSvgChange: (v: string) => void;
  onFileSvgChange: (svg: string) => void;
  onPixelSvgChange: (svg: string) => void;
  onTextSvgChange: (svg: string) => void;
  onTextChange?: (text: string) => void;
  onFontChange?: (font: string) => void;
  initialText?: string;
  initialFont?: string;
  droppedFile?: { name: string; content: string } | null;
  droppedRasterFile?: File | null;
  onRasterFileChange?: (file: File | null) => void;
}

const tabs = [
  { value: "draw", icon: Pencil, label: "Draw" },
  { value: "text", icon: Type, label: "Text" },
  { value: "code", icon: Code, label: "SVG Code" },
  { value: "file", icon: FileUp, label: "Upload File" },
];

const contentVariants = {
  enter: { opacity: 0, x: -8 },
  active: { opacity: 1, x: 0, transition: { duration: 0.15 } },
  exit: { opacity: 0, x: -8, transition: { duration: 0.1 } },
};

export function InputPanel({
  inputTab,
  onInputTabChange,
  customSvg,
  onCustomSvgChange,
  onFileSvgChange,
  onPixelSvgChange,
  onTextSvgChange,
  onTextChange,
  onFontChange,
  initialText,
  initialFont,
  droppedFile,
  droppedRasterFile,
  onRasterFileChange,
}: InputPanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Collapse on mobile after mount
  useEffect(() => {
    if (window.innerWidth < 768) setExpanded(false);
  }, []);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedSvgContent, setUploadedSvgContent] = useState<string | null>(null);
  const [rasterFile, setRasterFile] = useState<File | null>(null);
  const [rasterImageUrl, setRasterImageUrl] = useState<string | null>(null);
  const [rasterError, setRasterError] = useState<string | null>(null);
  const [isApng, setIsApng] = useState(false);
  const [colorProfile, setColorProfile] = useState<"cmyk" | "srgb">("srgb");
  const svgFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync dropped file from parent (drag-and-drop)
  useEffect(() => {
    if (droppedFile) {
      setUploadedFileName(droppedFile.name);
      setUploadedSvgContent(droppedFile.content);
      setRasterFile(null);
      setRasterImageUrl(null);
      setExpanded(true);
    }
  }, [droppedFile]);

  // Sync dropped raster file from parent
  useEffect(() => {
    if (droppedRasterFile) {
      handleRasterUpload(droppedRasterFile);
      setExpanded(true);
    }
  }, [droppedRasterFile]);

  // Render the uploaded SVG preview as an inert image. Encoding the markup as a
  // data URL and rendering it via <img> means the browser treats it as a static
  // image — embedded scripts and event-handler attributes never execute — so an
  // untrusted upload can't run JavaScript in the editor's origin.
  const previewUrl = uploadedSvgContent
    ? `data:image/svg+xml;utf8,${encodeURIComponent(uploadedSvgContent)}`
    : null;

  // Close panel when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  const handleTabClick = (value: string) => {
    if (inputTab === value && expanded) {
      setExpanded(false);
    } else {
      onInputTabChange(value);
      setExpanded(true);
    }
  };

  const handleRasterUpload = async (file: File) => {
    setRasterError(null);
    setUploadedFileName(file.name);
    setUploadedSvgContent(null);

    // Validate magic bytes
    const buffer = await file.arrayBuffer();
    if (!validateImageMagicBytes(buffer)) {
      setRasterError("Not a valid image file. Please upload a PNG, JPG, or WebP.");
      return;
    }

    // Size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      setRasterError("Image is too large (max 10 MB). Please resize it first.");
      return;
    }

    // Detect APNG (animated PNG) — extract first frame only
    const apngDetected = detectApng(buffer);
    setIsApng(apngDetected);

    // Detect CMYK color profile
    const profile = detectColorProfile(buffer);
    setColorProfile(profile);

    const url = URL.createObjectURL(file);
    setRasterFile(file);
    setRasterImageUrl(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isRasterFile(file)) {
      handleRasterUpload(file);
      onRasterFileChange?.(file);
    } else {
      setUploadedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (text) {
          setUploadedSvgContent(text);
          onFileSvgChange(text);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleRasterConfirm = (svg: string) => {
    onFileSvgChange(svg);
    setRasterFile(null);
    if (rasterImageUrl) {
      URL.revokeObjectURL(rasterImageUrl);
      setRasterImageUrl(null);
    }
  };

  const handleRasterCancel = () => {
    setRasterFile(null);
    setUploadedFileName(null);
    setRasterError(null);
    setIsApng(false);
    if (rasterImageUrl) {
      URL.revokeObjectURL(rasterImageUrl);
      setRasterImageUrl(null);
    }
    onRasterFileChange?.(null);
    if (svgFileInputRef.current) svgFileInputRef.current.value = "";
  };

  const handleRasterDownload = (svg: string) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (uploadedFileName?.replace(/\.[^.]+$/, "") || "vectorized") + ".svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={panelRef} className="flex items-start gap-2 pointer-events-none">
      {/* Vertical toolbar */}
      <div className="flex flex-col gap-1 rounded-xl bg-card/70 backdrop-blur-xl border border-white/[0.06] shadow-[0_8px_32px_oklch(0_0_0/0.4)] p-1.5 pointer-events-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = inputTab === tab.value;
          const isOpen = isSelected && expanded;
          return (
            <Tooltip key={tab.value}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${
                    isOpen
                      ? "bg-accent text-accent-foreground ring-1 ring-primary"
                      : isSelected
                        ? "bg-accent/50 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => handleTabClick(tab.value)}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{tab.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Expandable content panel */}
      <motion.div
        animate={expanded ? { opacity: 1, x: 0, pointerEvents: "auto" as const } : { opacity: 0, x: -8, pointerEvents: "none" as const }}
        transition={{ duration: 0.15 }}
        className="w-80 rounded-xl bg-card/70 backdrop-blur-xl border border-white/[0.06] shadow-[0_8px_32px_oklch(0_0_0/0.4)] p-3"
      >
            <div className={inputTab === "draw" ? "" : "hidden"}>
              <PixelEditor onSvgChange={onPixelSvgChange} />
            </div>
            <div className={inputTab === "text" ? "" : "hidden"}>
              <TextInput onSvgChange={onTextSvgChange} onTextChange={onTextChange} onFontChange={onFontChange} initialText={initialText} initialFont={initialFont} active={inputTab === "text" && expanded} />
            </div>
            <div className={inputTab === "code" ? "" : "hidden"}>
              <div className="space-y-2">
                <textarea
                  className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-xs font-mono h-32 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <path d="..." fill="black"/>\n</svg>`}
                  value={customSvg}
                  onChange={(e) => onCustomSvgChange(e.target.value)}
                />
                {!customSvg && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs w-full"
                    onClick={() => onCustomSvgChange('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="black"/></svg>')}
                  >
                    Load example (star)
                  </Button>
                )}
              </div>
            </div>
            <div className={inputTab === "file" ? "" : "hidden"}>
              {rasterFile && rasterImageUrl ? (
                <PngToSvgPanel
                  file={rasterFile}
                  imageUrl={rasterImageUrl}
                  isApng={isApng}
                  colorProfile={colorProfile}
                  onConfirm={handleRasterConfirm}
                  onCancel={handleRasterCancel}
                  onDownloadSvg={handleRasterDownload}
                />
              ) : uploadedFileName ? (
                <div className="space-y-3">
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt={uploadedFileName}
                      className="rounded-lg border border-white/[0.06] bg-white p-4 aspect-square w-full object-contain block"
                    />
                  )}
                  {rasterError && (
                    <p className="text-xs text-red-400">{rasterError}</p>
                  )}
                  <div className="flex items-center gap-3 rounded-md border border-input p-3">
                    <FileCheck className="h-5 w-5 text-primary shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{uploadedFileName}</span>
                    <button
                      onClick={() => {
                        setUploadedFileName(null);
                        setUploadedSvgContent(null);
                        setRasterFile(null);
                        setRasterError(null);
                        onFileSvgChange("");
                        onRasterFileChange?.(null);
                        if (svgFileInputRef.current) svgFileInputRef.current.value = "";
                      }}
                      className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-6">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Upload SVG, PNG, or JPG
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => svgFileInputRef.current?.click()}
                    >
                      Choose File
                    </Button>
                  </div>
                )}
                <input
                  ref={svgFileInputRef}
                  type="file"
                  accept=".svg,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                  className="hidden"
                  onChange={handleFileUpload}
                />
            </div>
      </motion.div>
    </div>
  );
}
