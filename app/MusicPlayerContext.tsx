"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

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
const MUSIC_PLAYER_VISIBLE_KEY = "dyespace.music_player_visible";
const MUSIC_PLAYER_INDEX_KEY = "dyespace.music_player_index";
const MUSIC_PLAYER_PLAYING_KEY = "dyespace.music_player_playing";

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    try {
      const minimizedValue = window.localStorage.getItem(MUSIC_PLAYER_MINIMIZED_KEY);
      const visibleValue = window.localStorage.getItem(MUSIC_PLAYER_VISIBLE_KEY);
      const indexValue = window.localStorage.getItem(MUSIC_PLAYER_INDEX_KEY);
      const playingValue = window.localStorage.getItem(MUSIC_PLAYER_PLAYING_KEY);

      if (minimizedValue === "true") {
        setIsMinimized(true);
      }
      if (visibleValue === "false") {
        setIsVisible(false);
      }
      if (indexValue !== null) {
        const parsed = Number.parseInt(indexValue, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          setCurrentIndex(parsed);
        }
      }
      if (playingValue === "true") {
        setIsPlaying(true);
      }
    } catch {
      // Ignore localStorage failures on hydration.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MUSIC_PLAYER_MINIMIZED_KEY, isMinimized ? "true" : "false");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isMinimized]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MUSIC_PLAYER_VISIBLE_KEY, isVisible ? "true" : "false");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MUSIC_PLAYER_INDEX_KEY, String(currentIndex));
    } catch {
      // Ignore localStorage failures.
    }
  }, [currentIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MUSIC_PLAYER_PLAYING_KEY, isPlaying ? "true" : "false");
    } catch {
      // Ignore localStorage failures.
    }
  }, [isPlaying]);

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