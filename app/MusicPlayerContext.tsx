"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

type MusicPlayerContextValue = {
  isMinimized: boolean;
  setIsMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  isVisible: boolean;
  setIsVisible: React.Dispatch<React.SetStateAction<boolean>>;
};

const MUSIC_PLAYER_MINIMIZED_KEY = "dyespace.music_player_minimized";

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useLayoutEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(MUSIC_PLAYER_MINIMIZED_KEY);
      if (storedValue === "true") {
        setIsMinimized(true);
      }
    } catch {
      // Ignore localStorage failures on hydration.
    }
  }, []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MUSIC_PLAYER_MINIMIZED_KEY, isMinimized ? "true" : "false");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isMinimized]);

  const value = useMemo(
    () => ({
      isMinimized,
      setIsMinimized,
      isPlaying,
      setIsPlaying,
      currentIndex,
      setCurrentIndex,
      isVisible,
      setIsVisible,
    }),
    [currentIndex, isMinimized, isPlaying, isVisible]
  );

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>;
}

export function useMusicPlayerContext() {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error("useMusicPlayerContext must be used within MusicPlayerProvider");
  }

  return context;
}