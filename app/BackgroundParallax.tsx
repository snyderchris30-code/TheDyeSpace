"use client";

import { useEffect } from "react";

const MAX_OFFSET = 140;
const PARALLAX_FACTOR = 0.14;

export default function BackgroundParallax() {
  useEffect(() => {
    const root = document.documentElement;
    const scroller = document.querySelector(".site-shell") as HTMLElement | null;

    let rafId = 0;

    const updateOffset = () => {
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY;
      const offset = Math.min(scrollTop * PARALLAX_FACTOR, MAX_OFFSET);
      root.style.setProperty("--bg-parallax-offset", `${offset.toFixed(2)}px`);
      rafId = 0;
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateOffset);
    };

    root.style.setProperty("--bg-parallax-offset", "0px");

    if (scroller) {
      scroller.addEventListener("scroll", onScroll, { passive: true });
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      if (scroller) {
        scroller.removeEventListener("scroll", onScroll);
      } else {
        window.removeEventListener("scroll", onScroll);
      }
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return null;
}
