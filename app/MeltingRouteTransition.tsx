"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const CLIP_SECONDS = 2;
const OVERLAY_FADE_MS = 420;
const FAILSAFE_MS = 3000;

export default function MeltingRouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const previousPathRef = useRef(pathname);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const finishingRef = useRef(false);

  const [showOverlay, setShowOverlay] = useState(false);
  const [isOverlayFading, setIsOverlayFading] = useState(false);
  const [showPage, setShowPage] = useState(true);
  const [playbackKey, setPlaybackKey] = useState(0);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const finishTransition = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;

    setIsOverlayFading(true);
    const hideTimer = window.setTimeout(() => {
      setShowOverlay(false);
      setIsOverlayFading(false);
      setShowPage(true);
      finishingRef.current = false;
    }, OVERLAY_FADE_MS);

    timersRef.current.push(hideTimer);
  }, []);

  const playFromStart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      video.currentTime = 0;
      video.playbackRate = 0.9;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          finishTransition();
        });
      }
    } catch {
      finishTransition();
    }
  }, [finishTransition]);

  useEffect(() => {
    if (previousPathRef.current === pathname) return;
    previousPathRef.current = pathname;

    clearTimers();
    finishingRef.current = false;

    let frameId = window.requestAnimationFrame(() => {
      setShowPage(false);
      setIsOverlayFading(false);
      setShowOverlay(true);
      setPlaybackKey((key) => key + 1);
    });

    const startTimer = window.setTimeout(() => {
      playFromStart();
    }, 40);

    const failsafeTimer = window.setTimeout(() => {
      finishTransition();
    }, FAILSAFE_MS);

    timersRef.current.push(startTimer, failsafeTimer);

    return () => {
      window.cancelAnimationFrame(frameId);
      clearTimers();
    };
  }, [clearTimers, finishTransition, pathname, playFromStart]);

  return (
    <>
      <div className={`transition-video-page${showPage ? " is-visible" : ""}`}>{children}</div>

      {showOverlay ? (
        <div
          className={`transition-video-overlay${isOverlayFading ? " is-fading" : ""}`}
          aria-hidden="true"
        >
          <video
            key={`melting-video-${pathname}-${playbackKey}`}
            ref={videoRef}
            className="transition-video-element"
            src="/melting-transition.mp4"
            muted
            playsInline
            preload="auto"
            autoPlay
            onLoadedData={playFromStart}
            onEnded={finishTransition}
            onError={finishTransition}
            onTimeUpdate={() => {
              const current = videoRef.current?.currentTime ?? 0;
              if (current >= CLIP_SECONDS) {
                finishTransition();
              }
            }}
          />
        </div>
      ) : null}
    </>
  );
}
