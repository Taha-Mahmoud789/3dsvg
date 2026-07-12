/**
 * =============================================================================
 * Export Bar
 * =============================================================================
 *
 * Bottom toolbar for exporting the 3D scene as PNG or video. Handles
 * transparent/background capture, resolution presets, video recording with
 * iOS-style trim UI, and MP4 conversion via FFmpeg WASM.
 */

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { track } from "@vercel/analytics";
import {
  Image,
  Video,
  Download,
  Square,
  Repeat,
  X,
  Settings2,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { VideoTrimmer } from "@/components/video-trimmer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/** Duration of one full animation cycle in seconds, at speed=1 */
function getCycleDuration(type: string, speed: number): number | null {
  const periods: Record<string, number> = {
    spin: (2 * Math.PI) / 0.5,
    float: (2 * Math.PI) / 1.5,
    pulse: (2 * Math.PI) / 2,
    wobble: (2 * Math.PI) / 2,
    swing: (2 * Math.PI) / 1.5,
    spinFloat: (2 * Math.PI) / 0.4,
  };
  const base = periods[type];
  if (!base) return null;
  return base / speed;
}

/* ── Shutter Button ── */
function ShutterButton({
  mode,
  onClick,
  disabled,
}: {
  mode: "image" | "video";
  onClick: () => void;
  disabled?: boolean;
}) {
  const isVideo = mode === "video";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="relative h-16 w-16 rounded-full flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 group"
    >
      {/* Outer ring */}
      <div
        className={`absolute inset-0 rounded-full border-[3px] transition-all duration-300 ${
          isVideo ? "border-red-500 shadow-[0_0_16px_oklch(0.6_0.22_25/0.3)]" : "border-primary shadow-[0_0_16px_oklch(0.78_0.15_195/0.3)]"
        }`}
      />
      {/* Inner fill */}
      <div
        className={`h-12 w-12 rounded-full transition-all duration-300 active:scale-90 ${
          isVideo ? "bg-red-500" : "bg-primary"
        }`}
      />
    </button>
  );
}

/* ── Viewfinder Overlay ── */
function ViewfinderOverlay({ aspectRatio }: { aspectRatio: number }) {
  const [dims, setDims] = useState({ vw: 0, vh: 0 });

  useEffect(() => {
    const update = () =>
      setDims({ vw: window.innerWidth, vh: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (dims.vw === 0) return null;

  const padding = 48;
  const availW = dims.vw - padding * 2;
  const availH = dims.vh - padding * 2;
  const viewportAspect = availW / availH;

  let rectW: number, rectH: number;
  if (aspectRatio > viewportAspect) {
    rectW = availW;
    rectH = availW / aspectRatio;
  } else {
    rectH = availH;
    rectW = availH * aspectRatio;
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[5]"
      style={{
        boxShadow: `0 0 0 9999px rgba(0,0,0,0.5)`,
        width: rectW,
        height: rectH,
        left: `calc(50% - ${rectW / 2}px)`,
        top: `calc(50% - ${rectH / 2}px)`,
        borderRadius: "8px",
      }}
    />
  );
}

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  captureFn: React.RefObject<
    | ((
        resolution: number,
        withBackground: boolean,
        onCapture: (dataUrl: string) => void,
        aspectRatio?: number | null
      ) => void)
    | null
  >;
  animate: string;
  animateSpeed: number;
  onPreviewOpen?: (isOpen: boolean) => void;
}

export function ExportModal({
  open,
  onClose,
  canvasRef,
  captureFn,
  animate,
  animateSpeed,
  onPreviewOpen,
}: ExportModalProps) {
  const [tab, setTab] = useState<"image" | "video">("image");
  const [resolution, setResolution] = useState(1920);
  const [withBg, setWithBg] = useState(true);
  const [videoFormat, setVideoFormat] = useState<"mp4" | "webm">("mp4");
  const [videoQuality, setVideoQuality] = useState<"low" | "mid" | "high">("high");
  const [aspect, setAspect] = useState<string>("free");
  const [videoCycles, setVideoCycles] = useState<number | null>(null);
  const [aspectExpanded, setAspectExpanded] = useState(false);
  const aspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Image capture result
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const aspectRatioValue: number | null = (() => {
    switch (aspect) {
      case "1:1":
        return 1;
      case "16:9":
        return 16 / 9;
      case "9:16":
        return 9 / 16;
      case "4:3":
        return 4 / 3;
      case "3:2":
        return 3 / 2;
      default:
        return null;
    }
  })();

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordingStartRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Post-recording state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // Notify parent when a preview dialog is open (so it can pause animations)
  const previewOpen = !!capturedImage || (!!videoUrl && !isRecording);
  useEffect(() => {
    onPreviewOpen?.(previewOpen);
  }, [previewOpen, onPreviewOpen]);

  // Timer
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setRecordingElapsed((Date.now() - recordingStartRef.current) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setRecordingElapsed(0);
  }, []);

  const startRecording = useCallback(
    (autoStopMs?: number) => {
      if (!canvasRef.current) return;

      setTimeout(() => {
        if (!canvasRef.current) return;
        chunksRef.current = [];
        recordingStartRef.current = Date.now();
        setRecordingElapsed(0);
        const bitrates = { low: 4_000_000, mid: 12_000_000, high: 24_000_000 };
        const stream = canvasRef.current.captureStream(60);
        const recorder = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp9",
          videoBitsPerSecond: bitrates[videoQuality],
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        const recordingStart = Date.now();
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          const url = URL.createObjectURL(blob);
          const dur = (Date.now() - recordingStart) / 1000;
          setVideoUrl(url);
          setTrimStart(0);
          setVideoDuration(dur);
          setTrimEnd(dur);
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);

        if (autoStopMs) {
          autoStopTimerRef.current = setTimeout(() => {
            stopRecording();
          }, autoStopMs);
        }
      }, 150);
    },
    [canvasRef, stopRecording]
  );

  const handleImageCapture = useCallback(() => {
    captureFn.current?.(
      720,
      withBg,
      (dataUrl) => {
        setCapturedImage(dataUrl);
      },
      aspectRatioValue
    );
  }, [captureFn, resolution, withBg, aspectRatioValue]);

  const handleImageDownload = useCallback(() => {
    captureFn.current?.(resolution, withBg, (dataUrl) => {
      const link = document.createElement("a");
      link.download = "svg-to-3d-export.png";
      link.href = dataUrl;
      link.click();
      track("Image Download", { resolution, withBackground: withBg, aspect: aspect });
    }, aspectRatioValue);
  }, [resolution, withBg, aspect, aspectRatioValue, captureFn]);

  const exportAbortRef = useRef(false);

  const handleVideoDownload = useCallback(async () => {
    if (!videoUrl) return;
    setIsExporting(true);
    exportAbortRef.current = false;

    try {
      // Fetch the recorded WebM blob
      const response = await fetch(videoUrl);
      const originalWebm = await response.blob();

      const startTime = trimStart <= 0.05 ? 0 : trimStart;
      const endTime = trimEnd >= videoDuration - 0.05 ? videoDuration : trimEnd;
      const hasTrim = startTime > 0 || endTime < videoDuration;
      const bitrateMap = { low: "2M", mid: "8M", high: "16M" };
      const bitrate = bitrateMap[videoQuality];

      if (videoFormat === "webm" && !aspectRatioValue && !hasTrim) {
        // Fast path: no processing needed, download original
        const url = URL.createObjectURL(originalWebm);
        const link = document.createElement("a");
        link.download = "svg-to-3d-video.webm";
        link.href = url;
        link.click();
        track("Video Download", { format: "webm", resolution, quality: videoQuality, aspect });
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        // Use FFmpeg for crop, trim, resize, and/or format conversion
        const { convertWebmToMp4 } = await import("@/lib/ffmpeg");

        if (exportAbortRef.current) return;

        // Build FFmpeg filter for crop + scale
        const filters: string[] = [];
        if (aspectRatioValue) {
          // Center crop to aspect ratio
          filters.push(`crop=ih*${aspectRatioValue}:ih:(iw-ih*${aspectRatioValue})/2:0`);
        }
        filters.push(`scale=${resolution}:-2`);

        const exportDuration = hasTrim ? (endTime - startTime) : videoDuration;
        const mp4Blob = await convertWebmToMp4(
          originalWebm,
          setExportStatus,
          {
            trimStart: hasTrim ? startTime : undefined,
            trimEnd: hasTrim ? endTime : undefined,
            filters: filters.join(","),
            bitrate,
            format: videoFormat,
            duration: exportDuration,
          }
        );

        if (exportAbortRef.current) return;

        const ext = videoFormat;
        const url = URL.createObjectURL(mp4Blob);
        const link = document.createElement("a");
        link.download = `svg-to-3d-video.${ext}`;
        link.href = url;
        link.click();
        track("Video Download", { format: videoFormat, resolution, quality: videoQuality, aspect });
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } finally {
      setExportStatus("");
      setIsExporting(false);
    }
  }, [
    videoUrl,
    trimStart,
    trimEnd,
    videoDuration,
    resolution,
    videoFormat,
    videoQuality,
    aspectRatioValue,
  ]);

  const handleClose = useCallback(() => {
    if (isRecording) stopRecording();
    exportAbortRef.current = true; // Cancel any in-progress conversion
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    if (capturedImage) setCapturedImage(null);
    setIsExporting(false);
    setExportStatus("");
    onClose();
  }, [isRecording, stopRecording, videoUrl, capturedImage, onClose]);

  const cycleSec =
    animate !== "none" ? getCycleDuration(animate, animateSpeed) : null;

  const aspectOptions = [
    { value: "free", label: "Auto" },
    { value: "1:1", label: "1:1" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
  ];

  // ── State 2: Recording pill ──
  if (isRecording && open) {
    return (
      <>
        {aspectRatioValue && <ViewfinderOverlay aspectRatio={aspectRatioValue} />}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-black/70 backdrop-blur-2xl border border-white/[0.08] shadow-[0_8px_32px_oklch(0_0_0/0.5),0_0_20px_oklch(0.78_0.15_195/0.08)] px-5 py-2.5"
        >
          <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-mono text-white tabular-nums">
            {autoStopTimerRef.current && cycleSec && videoCycles
              ? `${Math.max(0, cycleSec * videoCycles - recordingElapsed).toFixed(1)}s`
              : `${recordingElapsed.toFixed(1)}s`}
          </span>
          <button
            className="flex items-center gap-1.5 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            onClick={stopRecording}
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        </motion.div>
      </>
    );
  }

  // ── State 3a: Image preview dialog ──
  const imagePreviewDialog = (
    <Dialog
      open={!!capturedImage}
      onOpenChange={(v) => {
        if (!v) setCapturedImage(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Photo Preview</DialogTitle>
        </DialogHeader>
        {capturedImage && (
          <div
            className="rounded-lg overflow-hidden border border-white/[0.06]"
            style={{
              backgroundImage: `
                linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
                linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
                linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)
              `,
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            }}
          >
            <img
              src={capturedImage}
              alt="Captured preview"
              className="w-full max-h-[60vh] object-contain"
            />
          </div>
        )}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Resolution</span>
            <Select
              value={String(resolution)}
              onValueChange={(v) => setResolution(Number(v))}
            >
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1280">720p</SelectItem>
                <SelectItem value="1920">1080p</SelectItem>
                <SelectItem value="2560">1440p</SelectItem>
                <SelectItem value="3840">4K</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-muted-foreground">Background</span>
            <Switch checked={withBg} onCheckedChange={(v) => {
              setWithBg(v);
              captureFn.current?.(720, v, (dataUrl) => setCapturedImage(dataUrl), aspectRatioValue);
            }} />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setCapturedImage(null)}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button onClick={handleImageDownload} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Download PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── State 3b: Video preview dialog ──
  const videoPreviewDialog = (
    <Dialog
      open={!!videoUrl && !isRecording}
      onOpenChange={(v) => {
        if (!v && videoUrl) {
          URL.revokeObjectURL(videoUrl);
          setVideoUrl(null);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Video Preview</DialogTitle>
        </DialogHeader>
        {videoUrl && (
          <div className="space-y-3">
            <div
              className="rounded-lg border border-white/[0.06] overflow-hidden bg-black flex items-center justify-center max-h-[40vh] mx-auto"
              style={aspectRatioValue ? { aspectRatio: aspectRatioValue } : undefined}
            >
              <video
                ref={videoPreviewRef}
                src={videoUrl}
                className="w-full h-full cursor-pointer"
                style={{ objectFit: aspectRatioValue ? "cover" : "contain" }}
                onClick={() => {
                  const v = videoPreviewRef.current;
                  if (v) v.paused ? v.play() : v.pause();
                }}
                autoPlay={typeof window !== "undefined" && window.innerWidth >= 768}
                muted
                loop
              />
            </div>

            {videoDuration > 0 && (
              <VideoTrimmer
                videoUrl={videoUrl}
                duration={videoDuration}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onTrimStartChange={setTrimStart}
                onTrimEndChange={setTrimEnd}
                videoRef={videoPreviewRef}
              />
            )}
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Resolution</span>
            <Select value={String(resolution)} onValueChange={(v) => setResolution(Number(v))}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1280">720p</SelectItem>
                <SelectItem value="1920">1080p</SelectItem>
                <SelectItem value="2560">1440p</SelectItem>
                <SelectItem value="3840">4K</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Quality</span>
            <Select value={videoQuality} onValueChange={(v) => setVideoQuality(v as "low" | "mid" | "high")}>
              <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="mid">Mid</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Format</span>
            <Select value={videoFormat} onValueChange={(v) => setVideoFormat(v as "mp4" | "webm")}>
              <SelectTrigger className="h-8 w-22 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4</SelectItem>
                <SelectItem value="webm">WebM</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-end sm:justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              exportAbortRef.current = true;
              setIsExporting(false);
              setExportStatus("");
              if (videoUrl) URL.revokeObjectURL(videoUrl);
              setVideoUrl(null);
            }}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button
            onClick={handleVideoDownload}
            disabled={isExporting}
            className="gap-1.5 relative overflow-hidden"
          >
            {isExporting && (
              <div
                className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-300 ease-out"
                style={{ width: exportStatus.match(/(\d+)%/) ? `${exportStatus.match(/(\d+)%/)?.[1]}%` : "5%" }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {isExporting ? (
                <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span className="text-xs">Download {videoFormat.toUpperCase()}</span>
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── State 1: Camera bar ──
  return (
    <>
      {/* Viewfinder overlay */}
      {open && aspectRatioValue && (
        <ViewfinderOverlay aspectRatio={aspectRatioValue} />
      )}

      {/* Dialogs */}
      {imagePreviewDialog}
      {videoPreviewDialog}

      {/* Camera bar */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 350 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3"
          >
            {/* Cycle selector (above shutter, only for video with animation) */}
            <AnimatePresence>
              {tab === "video" && cycleSec && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="flex gap-1 rounded-full bg-black/50 backdrop-blur-xl border border-white/[0.1] p-1 shadow-[0_4px_16px_oklch(0_0_0/0.2)]"
                >
                  {[1, 2, 3].map((n) => (
                    <Tooltip key={n}>
                      <TooltipTrigger asChild>
                        <button
                          className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                            videoCycles === n
                              ? "bg-primary/20 text-primary shadow-[0_0_12px_oklch(0.78_0.15_195/0.15)]"
                              : "text-white/50 hover:text-white/80"
                          }`}
                          onClick={() => setVideoCycles(videoCycles === n ? null : n)}
                        >
                          <Repeat className="h-3 w-3" />
                          {n}x
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Record {n} animation {n === 1 ? "cycle" : "cycles"}</TooltipContent>
                    </Tooltip>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Shutter row */}
            <div className="flex items-center gap-4">
              {/* Shutter button */}
              {tab === "image" ? (
                <ShutterButton mode="image" onClick={handleImageCapture} />
              ) : (
                <ShutterButton
                  mode="video"
                  onClick={() => {
                    const autoStopMs = videoCycles && cycleSec ? cycleSec * videoCycles * 1000 : undefined;
                    startRecording(autoStopMs);
                  }}
                />
              )}
            </div>

            {/* Mode toggle + settings */}
            <div className="flex items-center gap-1 rounded-full bg-black/50 backdrop-blur-xl border border-white/[0.1] p-1 shadow-[0_4px_24px_oklch(0_0_0/0.3)]">
              <button
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  tab === "image"
                    ? "bg-primary/20 text-primary shadow-[0_0_12px_oklch(0.78_0.15_195/0.15)]"
                    : "text-white/50 hover:text-white/80"
                }`}
                onClick={() => setTab("image")}
              >
                Image
              </button>
              <button
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                  tab === "video"
                    ? "bg-primary/20 text-primary shadow-[0_0_12px_oklch(0.78_0.15_195/0.15)]"
                    : "text-white/50 hover:text-white/80"
                }`}
                onClick={() => setTab("video")}
              >
                Video
              </button>

              <div className="w-px h-5 bg-white/[0.1]" />

              {/* Aspect ratio — expand on hover */}
              <div
                className="flex items-center gap-0.5 overflow-hidden"
                onMouseLeave={() => {
                  if (aspectTimerRef.current) clearTimeout(aspectTimerRef.current);
                  aspectTimerRef.current = setTimeout(() => setAspectExpanded(false), 500);
                }}
              >
                <AnimatePresence mode="popLayout">
                  {aspectOptions.map((opt) => {
                    const isActive = aspect === opt.value;
                    if (!aspectExpanded && !isActive) return null;
                    return (
                      <motion.button
                        key={opt.value}
                        layout
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto", transition: { duration: 0.2, ease: "easeInOut" } }}
                        exit={{ opacity: 0, width: 0, transition: { duration: 0.5, ease: "easeInOut", opacity: { duration: 0.15 }, width: { delay: 0.12, duration: 0.4 } } }}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer overflow-hidden transition-colors ${
                          isActive && aspectExpanded
                            ? "bg-primary/20 text-primary shadow-[0_0_12px_oklch(0.78_0.15_195/0.15)]"
                            : isActive && !aspectExpanded
                              ? "text-white/60"
                              : "text-white/40 hover:text-white/70"
                        }`}
                        onClick={() => {
                          if (!aspectExpanded) {
                            setAspectExpanded(true);
                          } else {
                            setAspect(opt.value);
                          }
                        }}
                      >
                        {opt.label}
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Keep backward-compatible export
export { ExportModal as ExportBar };
