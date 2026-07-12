/**
 * =============================================================================
 * Video Trimmer
 * =============================================================================
 *
 * iOS-style filmstrip trim UI for recorded video. Generates thumbnails,
 * provides draggable start/end handles, and a scrub-to-seek playhead.
 */

"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoTrimmerProps {
  videoUrl: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (v: number) => void;
  onTrimEndChange: (v: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

const THUMB_COUNT = 12;
const HANDLE_WIDTH = 14;

export function VideoTrimmer({
  videoUrl,
  duration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
  videoRef,
}: VideoTrimmerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [dragging, setDragging] = useState<"start" | "end" | "scrub" | null>(null);
  const wasPlayingRef = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const seekRaf = useRef<number>(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const rafRef = useRef<number>(0);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Track playhead position via requestAnimationFrame
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const update = () => {
      setPlayheadTime(video.currentTime);

      // Loop within trim range (only when playing, not dragging handles)
      if (!video.paused && dragging !== "start" && dragging !== "end") {
        if (video.currentTime >= trimEnd - 0.05) {
          video.currentTime = trimStart;
        } else if (video.currentTime < trimStart - 0.05) {
          video.currentTime = trimStart;
        }
      }

      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [videoRef, trimStart, trimEnd, dragging]);

  // Sync play state + restart on ended
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      // Restart from trim start
      video.currentTime = trimStart;
      video.play().catch(() => {});
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [videoRef, trimStart]);

  // Generate thumbnails from video
  useEffect(() => {
    if (!videoUrl || duration <= 0) return;

    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.preload = "auto";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const thumbs: string[] = [];

    video.onloadeddata = async () => {
      canvas.width = 80;
      canvas.height = 50;

      for (let i = 0; i < THUMB_COUNT; i++) {
        const time = (i / THUMB_COUNT) * duration;
        video.currentTime = time;
        await new Promise<void>((resolve) => {
          video.onseeked = () => {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbs.push(canvas.toDataURL("image/jpeg", 0.5));
            resolve();
          };
          // Fallback
          setTimeout(resolve, 300);
        });
      }
      setThumbnails(thumbs);
    };
  }, [videoUrl, duration]);

  // Simple 1:1 mapping — full container width = full duration
  const timeToPx = (t: number) => (t / (duration || 1)) * containerWidth;
  const pxToTime = (px: number) => Math.max(0, Math.min(duration, (px / (containerWidth || 1)) * duration));

  // Throttled seek — batches seeks to one per animation frame
  const seekTo = useCallback((time: number) => {
    pendingSeek.current = time;
    if (!seekRaf.current) {
      seekRaf.current = requestAnimationFrame(() => {
        if (videoRef.current && pendingSeek.current !== null) {
          videoRef.current.currentTime = pendingSeek.current;
          pendingSeek.current = null;
        }
        seekRaf.current = 0;
      });
    }
  }, [videoRef]);

  const handlePointerDown = useCallback(
    (handle: "start" | "end") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(handle);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = pxToTime(x);

      if (dragging === "start") {
        const newStart = Math.min(time, trimEnd - 0.5);
        onTrimStartChange(Math.max(0, newStart));
        seekTo(Math.max(0, newStart));
      } else if (dragging === "end") {
        const newEnd = Math.max(time, trimStart + 0.2);
        onTrimEndChange(Math.min(duration, newEnd));
        seekTo(Math.min(duration, newEnd));
      } else if (dragging === "scrub") {
        const clamped = Math.max(trimStart, Math.min(trimEnd, time));
        seekTo(clamped);
      }
    },
    [dragging, trimStart, trimEnd, duration, onTrimStartChange, onTrimEndChange, seekTo, containerWidth]
  );

  const handlePointerUp = useCallback(() => {
    if (dragging === "scrub" && wasPlayingRef.current && videoRef.current) {
      videoRef.current.play();
    }
    setDragging(null);
  }, [dragging, videoRef]);

  // Pointer down on filmstrip — start scrub
  const handleStripPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!containerRef.current || !videoRef.current) return;
      if ((e.target as HTMLElement).dataset.handle) return;

      // Pause video and remember if it was playing
      wasPlayingRef.current = !videoRef.current.paused;
      videoRef.current.pause();

      // Seek to click position (clamped to trim range)
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = pxToTime(x);
      const clamped = Math.max(trimStart, Math.min(trimEnd, time));
      seekTo(clamped);

      setDragging("scrub");
      containerRef.current.setPointerCapture(e.pointerId);
    },
    [trimStart, trimEnd, videoRef, containerWidth]
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= trimEnd || video.currentTime < trimStart) {
        video.currentTime = trimStart;
      }
      video.play();
    } else {
      video.pause();
    }
  }, [videoRef, trimStart, trimEnd]);

  const leftPx = timeToPx(trimStart);
  const rightPx = timeToPx(trimEnd);
  const playheadPx = timeToPx(playheadTime);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-2">
        {/* Play/Pause */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={togglePlay}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        {/* Filmstrip */}
        <div
          ref={containerRef}
          className="relative h-12 rounded-lg overflow-hidden select-none touch-none flex-1 cursor-pointer"
          onPointerDown={handleStripPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Filmstrip thumbnails */}
          <div className="absolute inset-0 flex">
            {thumbnails.length > 0
              ? thumbnails.map((thumb, i) => (
                  <img
                    key={i}
                    src={thumb}
                    alt=""
                    className="h-full flex-1 object-cover"
                    draggable={false}
                  />
                ))
              : Array.from({ length: THUMB_COUNT }).map((_, i) => (
                  <div key={i} className="h-full flex-1 bg-zinc-800" />
                ))}
          </div>

          {/* Dimmed regions outside trim */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/70 pointer-events-none"
            style={{ width: leftPx }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/70 pointer-events-none"
            style={{ width: Math.max(0, containerWidth - rightPx) }}
          />

          {/* Selected region border — top and bottom yellow lines */}
          <div
            className="absolute top-0 bottom-0 border-y-[3px] border-amber-400 pointer-events-none rounded-sm"
            style={{
              left: leftPx - HANDLE_WIDTH,
              width: Math.max(0, rightPx - leftPx + HANDLE_WIDTH * 2),
            }}
          />

          {/* Playhead line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.5)] pointer-events-none z-10"
            style={{
              left: timeToPx(Math.max(trimStart, Math.min(trimEnd, playheadTime))),
            }}
          />

          {/* Left handle */}
          <div
            data-handle="start"
            className="absolute top-0 bottom-0 flex items-center justify-center cursor-col-resize bg-amber-400 rounded-l-md z-20"
            style={{ left: Math.max(0, leftPx - HANDLE_WIDTH), width: HANDLE_WIDTH }}
            onPointerDown={handlePointerDown("start")}
          >
            <svg width="6" height="16" viewBox="0 0 6 16" className="text-amber-900">
              <path d="M4 2L2 8L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>

          {/* Right handle */}
          <div
            data-handle="end"
            className="absolute top-0 bottom-0 flex items-center justify-center cursor-col-resize bg-amber-400 rounded-r-md z-20"
            style={{ left: Math.min(rightPx, containerWidth - HANDLE_WIDTH), width: HANDLE_WIDTH }}
            onPointerDown={handlePointerDown("end")}
          >
            <svg width="6" height="16" viewBox="0 0 6 16" className="text-amber-900">
              <path d="M2 2L4 8L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
        </div>
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono px-10">
        <span>{trimStart.toFixed(1)}s</span>
        <span>{(trimEnd - trimStart).toFixed(1)}s</span>
        <span>{trimEnd.toFixed(1)}s</span>
      </div>
    </div>
  );
}
