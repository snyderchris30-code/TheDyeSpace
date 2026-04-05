"use client";
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Minus, Plus, X } from "lucide-react";

interface LightboxModalProps {
  imageUrl: string;
  onClose: () => void;
}

export default function LightboxModal({ imageUrl, onClose }: LightboxModalProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ distance: number; scale: number; offset: { x: number; y: number }; center: { x: number; y: number } } | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!imageRef.current) {
      return;
    }

    imageRef.current.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
    imageRef.current.style.transition = pointersRef.current.size ? "none" : "transform 180ms ease-out";
  }, [offset, scale]);

  const clampScale = (value: number) => Math.min(4, Math.max(1, value));

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    gestureRef.current = null;
  };

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

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...pointersRef.current.values()];
    if (points.length === 2) {
      gestureRef.current = {
        distance: getDistance(points),
        scale,
        offset,
        center: getCenter(points),
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointersRef.current.values()];

    if (points.length === 2 && gestureRef.current) {
      const nextDistance = getDistance(points);
      const nextCenter = getCenter(points);
      const nextScale = clampScale(gestureRef.current.scale * (nextDistance / gestureRef.current.distance));
      setScale(nextScale);
      setOffset({
        x: gestureRef.current.offset.x + (nextCenter.x - gestureRef.current.center.x),
        y: gestureRef.current.offset.y + (nextCenter.y - gestureRef.current.center.y),
      });
      return;
    }

    if (points.length === 1 && scale > 1) {
      const point = points[0];
      const previousPoint = gestureRef.current?.center ?? point;
      setOffset((currentOffset) => ({
        x: currentOffset.x + (point.x - previousPoint.x),
        y: currentOffset.y + (point.y - previousPoint.y),
      }));
      gestureRef.current = {
        distance: 0,
        scale,
        offset,
        center: point,
      };
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    pointersRef.current.delete(event.pointerId);

    const points = [...pointersRef.current.values()];
    if (points.length < 2) {
      gestureRef.current = points[0]
        ? { distance: 0, scale, offset, center: points[0] }
        : null;
    }
  };

  const adjustScale = (delta: number) => {
    setScale((current) => {
      const next = clampScale(current + delta);
      if (next === 1) {
        setOffset({ x: 0, y: 0 });
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/92 backdrop-blur-md cosmic-glow p-3 sm:p-6" onClick={onClose}>
      <div className="absolute left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-center justify-between sm:left-6 sm:right-6">
        <div className="rounded-full border border-cyan-300/20 bg-black/50 px-3 py-2 text-xs text-cyan-100/80 backdrop-blur-xl sm:text-sm">
          Pinch or use +/- to zoom
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
        <Image
          ref={imageRef}
          src={imageUrl}
          alt="Zoomed post"
          className="max-h-[84vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => {
            if (scale > 1) {
              resetView();
            } else {
              setScale(2);
            }
          }}
          width={800}
          height={800}
          unoptimized
        />
      </div>
    </div>
  );
}
