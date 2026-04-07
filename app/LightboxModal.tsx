"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";

interface LightboxModalProps {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

type GestureState = {
  distance: number;
  scale: number;
  offset: { x: number; y: number };
  center: { x: number; y: number };
  mode: "pinch" | "pan" | "swipe";
};

function clampIndex(index: number, total: number) {
  if (!total) return 0;
  return Math.min(total - 1, Math.max(0, index));
}

export default function LightboxModal({ images, initialIndex = 0, onClose }: LightboxModalProps) {
  const galleryImages = images.filter(Boolean);
  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(initialIndex, galleryImages.length));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<GestureState | null>(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const swipeOffsetRef = useRef(0);

  const imageUrl = galleryImages[currentIndex];
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < galleryImages.length - 1;

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setSwipeOffset(0);
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    swipeOffsetRef.current = 0;
    gestureRef.current = null;
  }, []);

  const goToIndex = useCallback((nextIndex: number) => {
    resetView();
    setCurrentIndex(clampIndex(nextIndex, galleryImages.length));
  }, [galleryImages.length, resetView]);

  const goToPrevious = useCallback(() => {
    if (!canGoPrevious) return;
    goToIndex(currentIndex - 1);
  }, [canGoPrevious, currentIndex, goToIndex]);

  const goToNext = useCallback(() => {
    if (!canGoNext) return;
    goToIndex(currentIndex + 1);
  }, [canGoNext, currentIndex, goToIndex]);

  const clampScale = useCallback((value: number) => Math.min(4, Math.max(1, value)), []);

  const adjustScale = useCallback((delta: number) => {
    setScale((current) => {
      const next = clampScale(current + delta);
      if (next === 1) {
        setOffset({ x: 0, y: 0 });
        offsetRef.current = { x: 0, y: 0 };
      }
      scaleRef.current = next;
      return next;
    });
  }, [clampScale]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goToPrevious();
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "+" || e.key === "=") {
        adjustScale(0.25);
      }
      if (e.key === "-") {
        adjustScale(-0.25);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [adjustScale, goToNext, goToPrevious, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    swipeOffsetRef.current = swipeOffset;
  }, [swipeOffset]);

  useEffect(() => {
    if (!imageRef.current) {
      return;
    }

    const translateX = scale > 1 ? offset.x : swipeOffset;
    const translateY = scale > 1 ? offset.y : 0;
    imageRef.current.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    imageRef.current.style.transition = pointersRef.current.size ? "none" : "transform 180ms ease-out";
  }, [imageUrl, offset, scale, swipeOffset]);

  const getDistance = (points: { x: number; y: number }[]) => {
    const [first, second] = points;
    return Math.hypot(second.x - first.x, second.y - first.y);
  };

  const getCenter = (points: { x: number; y: number }[]) => {
    const [first, second] = points;
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointersRef.current.values()];
    if (points.length === 2) {
      gestureRef.current = {
        distance: getDistance(points),
        scale: scaleRef.current,
        offset: offsetRef.current,
        center: getCenter(points),
        mode: "pinch",
      };
      return;
    }

    if (points.length === 1) {
      gestureRef.current = {
        distance: 0,
        scale: scaleRef.current,
        offset: offsetRef.current,
        center: points[0],
        mode: scaleRef.current > 1 ? "pan" : "swipe",
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];

    if (points.length === 2 && gestureRef.current) {
      const nextDistance = getDistance(points);
      const nextCenter = getCenter(points);
      const nextScale = clampScale(gestureRef.current.scale * (nextDistance / gestureRef.current.distance));
      const nextOffset = {
        x: gestureRef.current.offset.x + (nextCenter.x - gestureRef.current.center.x),
        y: gestureRef.current.offset.y + (nextCenter.y - gestureRef.current.center.y),
      };
      setScale(nextScale);
      setOffset(nextOffset);
      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      return;
    }

    if (points.length === 1 && gestureRef.current) {
      const point = points[0];
      const deltaX = point.x - gestureRef.current.center.x;
      const deltaY = point.y - gestureRef.current.center.y;

      if (scaleRef.current > 1 || gestureRef.current.mode === "pan") {
        const nextOffset = {
          x: offsetRef.current.x + deltaX,
          y: offsetRef.current.y + deltaY,
        };
        setOffset(nextOffset);
        offsetRef.current = nextOffset;
        gestureRef.current = {
          ...gestureRef.current,
          center: point,
          mode: "pan",
        };
        return;
      }

      if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        const nextSwipeOffset = Math.max(-180, Math.min(180, swipeOffsetRef.current + deltaX));
        setSwipeOffset(nextSwipeOffset);
        swipeOffsetRef.current = nextSwipeOffset;
      }

      gestureRef.current = {
        ...gestureRef.current,
        center: point,
        mode: "swipe",
      };
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    pointersRef.current.delete(event.pointerId);

    const points = [...pointersRef.current.values()];
    if (points.length === 1) {
      gestureRef.current = points[0]
        ? { distance: 0, scale: scaleRef.current, offset: offsetRef.current, center: points[0], mode: scaleRef.current > 1 ? "pan" : "swipe" }
        : null;
      return;
    }

    if (points.length === 0) {
      if (scaleRef.current === 1 && Math.abs(swipeOffsetRef.current) > 80) {
        if (swipeOffsetRef.current < 0) {
          goToNext();
        } else {
          goToPrevious();
        }
      }

      setSwipeOffset(0);
      swipeOffsetRef.current = 0;
      gestureRef.current = null;
    }
  };

  if (!galleryImages.length) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/92 backdrop-blur-md cosmic-glow p-3 sm:p-6" onClick={onClose}>
      <div className="absolute left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-center justify-between sm:left-6 sm:right-6">
        <div className="rounded-full border border-cyan-300/20 bg-black/50 px-3 py-2 text-xs text-cyan-100/80 backdrop-blur-xl sm:text-sm">
          {galleryImages.length > 1 ? `Swipe or use arrows to browse · ${currentIndex + 1} / ${galleryImages.length}` : "Pinch or use +/- to zoom"}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            aria-label="Zoom out"
            onClick={(event) => {
              event.stopPropagation();
              adjustScale(-0.25);
            }}
          >
            <Minus className="h-5 w-5" />
          </button>
          <button
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            aria-label="Zoom in"
            onClick={(event) => {
              event.stopPropagation();
              adjustScale(0.25);
            }}
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
            aria-label="Close"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>
      <div className="flex h-full w-full items-center justify-center overflow-hidden" onClick={(event) => event.stopPropagation()}>
        {galleryImages.length > 1 ? (
          <>
            <button
              type="button"
              className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/55 p-3 text-white transition hover:bg-black/80 sm:left-6 ${canGoPrevious ? "opacity-100" : "cursor-not-allowed opacity-40"}`}
              aria-label="Previous image"
              disabled={!canGoPrevious}
              onClick={goToPrevious}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              className={`absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/55 p-3 text-white transition hover:bg-black/80 sm:right-6 ${canGoNext ? "opacity-100" : "cursor-not-allowed opacity-40"}`}
              aria-label="Next image"
              disabled={!canGoNext}
              onClick={goToNext}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
        <div
          className="flex h-full w-full items-center justify-center overflow-hidden touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => {
            if (scale > 1) {
              resetView();
            } else {
              setScale(2);
              scaleRef.current = 2;
            }
          }}
          onWheel={(event) => {
            event.preventDefault();
            adjustScale(event.deltaY < 0 ? 0.2 : -0.2);
          }}
        >
          <Image
            key={imageUrl}
            ref={imageRef}
            src={imageUrl}
            alt={`Gallery image ${currentIndex + 1} of ${galleryImages.length}`}
            className="max-h-[84vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl select-none"
            draggable={false}
            width={800}
            height={800}
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}
