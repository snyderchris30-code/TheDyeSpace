
"use client";
// --- Spotify helpers ---
const SPOTIFY_PLAYLIST_REGEX = /https?:\/\/(open\.)?spotify\.com\/playlist\/([a-zA-Z0-9]+)(\?.*)?/;
async function fetchSpotifyPlaylistMeta(playlistUrl: string) {
  // Use Spotify oEmbed (no auth required)
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(playlistUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      url: data.url,
    };
  } catch {
    return null;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause, Play, Plus, SkipBack, SkipForward, X } from "lucide-react";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { createClient } from "@/lib/supabase/client";
import {
  buildMusicQueue,
  extractYoutubeVideoId,
  normalizeMusicPlayerUrls,
  resolveYoutubeEmbedOrigin,
  type MusicQueueEntry,
} from "@/lib/youtube-media";
import { DEFAULT_PUBLIC_MUSIC_TITLE, DEFAULT_PUBLIC_MUSIC_URL } from "@/lib/app-config";
import { useMusicPlayerContext } from "@/app/MusicPlayerContext";

const MUSIC_PLAYER_POSITION_KEY = "dyespace.music_player_position";

type SpotifyQueueEntry = {
  rawUrl: string;
  kind: "spotify";
  key: string;
  playlistId: string;
  titleHint: string;
};

type PlayerQueueEntry = MusicQueueEntry | SpotifyQueueEntry;

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
    __dyeSpaceYoutubeReadyCallbacks?: Array<() => void>;
  }
}

function ensureYouTubeApi(onReady: () => void) {
  if (typeof window === "undefined") {
    return;
  }

  if (window.YT?.Player) {
    onReady();
    return;
  }

  window.__dyeSpaceYoutubeReadyCallbacks = window.__dyeSpaceYoutubeReadyCallbacks || [];
  window.__dyeSpaceYoutubeReadyCallbacks.push(onReady);

  const existingScript = document.querySelector("script[data-youtube-iframe-api='true']");
  if (existingScript) {
    return;
  }

  window.onYouTubeIframeAPIReady = () => {
    const callbacks = window.__dyeSpaceYoutubeReadyCallbacks || [];
    callbacks.forEach((callback) => callback());
    window.__dyeSpaceYoutubeReadyCallbacks = [];
  };

  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  script.dataset.youtubeIframeApi = "true";
  document.head.appendChild(script);
}

export default function GlobalMusicPlayer() {
  const supabase = useMemo(() => createClient(), []);
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const loadedEntryKeyRef = useRef<string | null>(null);
  const pendingPlayIntentRef = useRef(false);
  const restoredPositionRef = useRef<{ key: string; time: number } | null>(null);
  const lastPersistedSecondRef = useRef<number>(-1);
  const currentEntryRef = useRef<PlayerQueueEntry | null>(null);
  const queueLengthRef = useRef(0);
  const lastSessionUserIdRef = useRef<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [musicUrls, setMusicUrls] = useState<string[]>([]);
  const [isApiReady, setIsApiReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const {
    isPlaying,
    setIsPlaying,
    currentIndex,
    setCurrentIndex,
    isMinimized,
    setIsMinimized,
    isVisible,
    setIsVisible,
  } = useMusicPlayerContext();
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [editorInput, setEditorInput] = useState("");
  const [editorUrls, setEditorUrls] = useState<string[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [spotifyInput, setSpotifyInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState(DEFAULT_PUBLIC_MUSIC_TITLE);
  const [titleCache, setTitleCache] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MUSIC_PLAYER_POSITION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { key?: unknown; time?: unknown };
      if (typeof parsed?.key !== "string") return;
      const parsedTime = typeof parsed?.time === "number" ? parsed.time : Number(parsed?.time);
      if (!Number.isFinite(parsedTime) || parsedTime < 0) return;
      restoredPositionRef.current = {
        key: parsed.key,
        time: parsedTime,
      };
    } catch {
      // Ignore malformed persisted playback snapshots.
    }
  }, []);

  const defaultPublicUrls = useMemo(() => normalizeMusicPlayerUrls([DEFAULT_PUBLIC_MUSIC_URL]), []);
  const defaultPublicUrl = defaultPublicUrls[0] || "";
  const hasCustomSongs = Boolean(session?.user && musicUrls.length > 0);
  const mergedUrls = useMemo(() => {
    const dedupedUserUrls = normalizeMusicPlayerUrls(musicUrls).filter((url) => url !== defaultPublicUrl);
    if (hasCustomSongs) {
      return dedupedUserUrls;
    }
    return defaultPublicUrl ? [defaultPublicUrl, ...dedupedUserUrls] : dedupedUserUrls;
  }, [defaultPublicUrl, hasCustomSongs, musicUrls]);

  // --- Music queue with Spotify support ---
  const queue = useMemo<PlayerQueueEntry[]>(() => {
    // Add Spotify playlists as special entries
    const urls = mergedUrls;
    return urls.map((url, idx) => {
      const spotifyMatch = SPOTIFY_PLAYLIST_REGEX.exec(url);
      if (spotifyMatch) {
        return {
          rawUrl: url,
          kind: "spotify",
          key: `spotify:${spotifyMatch[2]}`,
          playlistId: spotifyMatch[2],
          titleHint: `Spotify Playlist ${idx + 1}`,
        };
      }
      return buildMusicQueue([url])[0];
    }).filter((entry): entry is PlayerQueueEntry => Boolean(entry));
  }, [mergedUrls]);
  const currentEntry = queue[currentIndex] ?? null;

  useEffect(() => {
    const defaultEntry = queue.find((entry) => entry.rawUrl === defaultPublicUrl);
    if (!defaultEntry) return;

    setTitleCache((prev) => {
      if (prev[defaultEntry.key]) {
        return prev;
      }
      return { ...prev, [defaultEntry.key]: DEFAULT_PUBLIC_MUSIC_TITLE };
    });
  }, [defaultPublicUrl, queue]);

  useEffect(() => {
    currentEntryRef.current = currentEntry;
    queueLengthRef.current = queue.length;
  }, [currentEntry, queue.length]);

  const loadProfileMusic = useCallback(
    async (userId: string) => {
      try {
        const data = await fetchClientProfile<{
          username?: string | null;
          theme_settings?: {
            music_player_urls?: string[] | null;
            show_music_player?: boolean | null;
          } | null;
        }>(supabase, userId, "username, theme_settings", { ensureProfile: true });

        const nextUrls = normalizeMusicPlayerUrls(
          Array.isArray(data?.theme_settings?.music_player_urls) ? data.theme_settings.music_player_urls : []
        );

        const showMusicPlayer = data?.theme_settings?.show_music_player !== false;

        setProfileUsername(data?.username || null);
        setMusicUrls(nextUrls);
        setIsVisible(showMusicPlayer);
        setStatus(null);
      } catch (error: any) {
        console.error("[music-player] Failed to load profile music", error);
        setProfileUsername(null);
        setMusicUrls([]);
        setIsVisible(true);
        setCurrentTitle(DEFAULT_PUBLIC_MUSIC_TITLE);
        setStatus(typeof error?.message === "string" ? error.message : "Could not load your playlist.");
        return;
      }
    },
    [setCurrentTitle, setIsVisible, supabase]
  );

  const persistPlaylist = useCallback(async (nextUrls: string[], successMessage?: string) => {
    setStatus(null);

    try {
      const response = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ music_player_urls: nextUrls }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Could not save your playlist.");
      }

      setMusicUrls(normalizeMusicPlayerUrls(nextUrls).filter((url) => url !== defaultPublicUrl));
      setStatus(successMessage || "Playlist saved.");
    } catch (error: any) {
      setStatus(typeof error?.message === "string" ? error.message : "Could not save your playlist.");
    }
  }, [defaultPublicUrl]);

  useEffect(() => {
    setCurrentIndex((prev) => {
      if (!queue.length) return 0;
      return Math.min(prev, queue.length - 1);
    });
  }, [queue.length, setCurrentIndex]);

  const ensureYouTubeApiReady = useCallback(() => {
    if (isApiReady) {
      return;
    }

    ensureYouTubeApi(() => setIsApiReady(true));
  }, [isApiReady]);

  useEffect(() => {
    const syncAuth = async () => {
      const authState = await resolveClientAuth(supabase);
      const nextSession = authState.session || null;
      lastSessionUserIdRef.current = authState.user?.id ?? null;
      setSession(nextSession);

      if (authState.user?.id) {
        void loadProfileMusic(authState.user.id);
        return;
      }

      setProfileUsername(null);
      setMusicUrls([]);
      setCurrentIndex(0);
      setIsVisible(true);
      setCurrentTitle(DEFAULT_PUBLIC_MUSIC_TITLE);
      setIsPlaying(false);
      setStatus(authState.errorMessage ? "Could not verify your session. Using the public playlist." : null);
      if (playerRef.current && readyRef.current) {
        playerRef.current.stopVideo?.();
      }
    };

    void syncAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null;

      if ((_event === "TOKEN_REFRESHED" || _event === "INITIAL_SESSION") && nextUserId === lastSessionUserIdRef.current) {
        return;
      }

      lastSessionUserIdRef.current = nextUserId;
      setSession(nextSession || null);
      if (nextUserId) {
        void loadProfileMusic(nextUserId);
        return;
      }

      void syncAuth();
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [loadProfileMusic, setCurrentIndex, setIsPlaying, setIsVisible, supabase]);

  useEffect(() => {
    if (!isApiReady || !playerMountRef.current || playerRef.current) {
      return;
    }

    playerMountRef.current.innerHTML = "";
    const playerOrigin = resolveYoutubeEmbedOrigin(window.location.origin) || "https://www.thedyespace.app";
    const playerVars: Record<string, number | string> = {
      // Respect YouTube embed behavior: no forced autoplay on load.
      autoplay: 0,
      controls: 0,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: playerOrigin,
    };

    playerRef.current = new window.YT.Player(playerMountRef.current, {
      host: "https://www.youtube-nocookie.com",
      width: "1",
      height: "1",
      playerVars,
      events: {
        onReady: () => {
          readyRef.current = true;
          setIsPlayerReady(true);
          if (pendingPlayIntentRef.current) {
            pendingPlayIntentRef.current = false;
            setIsPlaying(true);
          }
        },
        onStateChange: (event: any) => {
          const state = event?.data;
          const player = playerRef.current;
          const videoData = player?.getVideoData?.();
          if (videoData?.title) {
            setCurrentTitle(videoData.title);
          }
          if (state === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true);
            return;
          }
          if (state === window.YT.PlayerState.PAUSED || state === window.YT.PlayerState.CUED) {
            setIsPlaying(false);
            return;
          }
          if (state === window.YT.PlayerState.ENDED) {
            if (currentEntryRef.current?.kind === "video" && queueLengthRef.current > 0) {
              setIsPlaying(true);
              setCurrentIndex((prev) => (prev + 1) % queueLengthRef.current);
              return;
            }
            setIsPlaying(false);
          }
        },
      },
    });

    return () => {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      readyRef.current = false;
      loadedEntryKeyRef.current = null;
    };
  }, [isApiReady, setCurrentIndex, setIsPlaying]);

  useEffect(() => {
    if (!currentEntry || !isPlayerReady || !playerRef.current) {
      if (!queue.length) {
        setCurrentTitle(DEFAULT_PUBLIC_MUSIC_TITLE);
      }
      return;
    }

    if (loadedEntryKeyRef.current === currentEntry.key) {
      if (currentEntry.kind === "video" || currentEntry.kind === "playlist") {
        if (isPlaying) {
          playerRef.current.playVideo?.();
        } else {
          playerRef.current.pauseVideo?.();
        }
      }
      return;
    }

    loadedEntryKeyRef.current = currentEntry.key;
    if (currentEntry.kind === "playlist" && currentEntry.playlistId) {
      if (isPlaying) {
        playerRef.current.loadPlaylist({
          list: currentEntry.playlistId,
          listType: "playlist",
          index: 0,
        });
      } else {
        playerRef.current.cuePlaylist({
          list: currentEntry.playlistId,
          listType: "playlist",
          index: 0,
        });
      }
      setCurrentTitle(titleCache[currentEntry.key] || currentEntry.titleHint);
      const restore = restoredPositionRef.current;
      if (restore?.key === currentEntry.key && restore.time > 0) {
        playerRef.current.seekTo?.(restore.time, true);
      }
      return;
    }

    if (currentEntry.kind === "video" && currentEntry.videoId) {
      if (isPlaying) {
        playerRef.current.loadVideoById(currentEntry.videoId);
      } else {
        playerRef.current.cueVideoById(currentEntry.videoId);
      }
      setCurrentTitle(titleCache[currentEntry.key] || currentEntry.titleHint);
      const restore = restoredPositionRef.current;
      if (restore?.key === currentEntry.key && restore.time > 0) {
        playerRef.current.seekTo?.(restore.time, true);
      }
    }
  }, [currentEntry, isPlayerReady, isPlaying, queue.length, titleCache]);

  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !currentEntry || currentEntry.kind === "spotify") {
      return;
    }

    const persistPosition = () => {
      try {
        const currentTime = Number(playerRef.current?.getCurrentTime?.() ?? 0);
        if (!Number.isFinite(currentTime) || currentTime < 0) {
          return;
        }

        const second = Math.floor(currentTime);
        if (second === lastPersistedSecondRef.current) {
          return;
        }
        lastPersistedSecondRef.current = second;

        window.localStorage.setItem(
          MUSIC_PLAYER_POSITION_KEY,
          JSON.stringify({
            key: currentEntry.key,
            time: currentTime,
          })
        );
      } catch {
        // Ignore storage failures.
      }
    };

    const timer = window.setInterval(persistPosition, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [currentEntry, isPlayerReady]);

  useEffect(() => {
    const uncached = queue.filter((entry) => entry.kind === "video" && entry.videoId && !titleCache[entry.key]).slice(0, 8);
    if (!uncached.length) {
      return;
    }

    let active = true;

    const loadTitles = async () => {
      for (const entry of uncached) {
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(entry.rawUrl)}&format=json`);
          if (!response.ok) continue;
          const body = await response.json();
          const title = typeof body?.title === "string" ? body.title : entry.titleHint;
          if (active) {
            setTitleCache((prev) => ({ ...prev, [entry.key]: title }));
          }
        } catch {
          // Keep fallback labels when title lookup fails.
        }
      }
    };

    void loadTitles();
    return () => {
      active = false;
    };
  }, [queue, titleCache]);

  useEffect(() => {
    if (currentEntry) {
      const fallbackTitle = titleCache[currentEntry.key] || currentEntry.titleHint;
      setCurrentTitle((prev) => (prev === "Nothing playing" ? fallbackTitle : prev));
    }
  }, [currentEntry, titleCache]);

  const handleTogglePlayback = useCallback(() => {
    if (!currentEntry) {
      return;
    }

    if (currentEntry.kind === "spotify") {
      setStatus("Spotify items open in Spotify. Add YouTube links for in-player playback.");
      return;
    }

    if (!isApiReady) {
      setStatus("Preparing the YouTube player...");
      pendingPlayIntentRef.current = true;
      setIsPlaying(true);
      ensureYouTubeApiReady();
      return;
    }

    if (!playerRef.current) {
      setStatus("Preparing the YouTube player...");
      pendingPlayIntentRef.current = true;
      setIsPlaying(true);
      ensureYouTubeApiReady();
      return;
    }

    if (isPlaying) {
      playerRef.current.pauseVideo?.();
      setIsPlaying(false);
      return;
    }

    playerRef.current.playVideo?.();
    setIsPlaying(true);
  }, [currentEntry, ensureYouTubeApiReady, isApiReady, isPlaying, setIsPlaying]);

  const handlePrevious = useCallback(() => {
    if (!queue.length || !currentEntry) {
      return;
    }

    if (currentEntry.kind === "playlist" && playerRef.current?.previousVideo) {
      playerRef.current.previousVideo();
      setIsPlaying(true);
      return;
    }

    setCurrentIndex((prev) => (prev - 1 + queue.length) % queue.length);
    setIsPlaying(true);
  }, [currentEntry, queue.length, setCurrentIndex, setIsPlaying]);

  const handleNext = useCallback(() => {
    if (!queue.length || !currentEntry) {
      return;
    }

    if (currentEntry.kind === "playlist" && playerRef.current?.nextVideo) {
      playerRef.current.nextVideo();
      setIsPlaying(true);
      return;
    }

    setCurrentIndex((prev) => (prev + 1) % queue.length);
    setIsPlaying(true);
  }, [currentEntry, queue.length, setCurrentIndex, setIsPlaying]);


  const handleOpenMusicEditor = () => {
    if (!session?.user) {
      setStatus("Sign in to add your own songs.");
      return;
    }
    setEditorInput("");
    setEditorUrls([...musicUrls]);
    setIsEditorMode(true);
    setStatus(null);
  };

  const handleEditorAdd = () => {
    const rawItems = editorInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!rawItems.length) {
      setStatus("Paste at least one YouTube video or playlist URL.");
      return;
    }
    const nextUrls = normalizeMusicPlayerUrls([...editorUrls, ...rawItems]);
    if (!nextUrls.length) {
      setStatus("Only valid YouTube video or playlist URLs can be added.");
      return;
    }
    setEditorUrls(nextUrls);
    setEditorInput("");
    setStatus(null);
  };

  const handleEditorRemove = (url: string) => {
    setEditorUrls((prev) => prev.filter((item) => item !== url));
  };

  const handleEditorSave = async () => {
    setEditorSaving(true);
    await persistPlaylist(editorUrls, "Playlist saved.");
    setIsEditorMode(false);
    setEditorSaving(false);
  };

  const handleEditorCancel = () => {
    setIsEditorMode(false);
    setStatus(null);
  };

  const removeSong = async (url: string) => {
    if (url === defaultPublicUrl) {
      setStatus("Default public song is pinned and cannot be removed.");
      return;
    }

    const nextUrls = musicUrls.filter((item) => item !== url);
    await persistPlaylist(nextUrls, "Playlist updated.");
    if (currentEntry?.rawUrl === url) {
      loadedEntryKeyRef.current = null;
      setCurrentIndex(0);
      setCurrentTitle(nextUrls.length ? "Select play to resume." : DEFAULT_PUBLIC_MUSIC_TITLE);
      setIsPlaying(false);
      playerRef.current?.pauseVideo?.();
    }
  };

  const [spotifyMeta, setSpotifyMeta] = useState<any>(null);
  useEffect(() => {
    if (currentEntry?.kind === "spotify" && currentEntry.rawUrl) {
      fetchSpotifyPlaylistMeta(currentEntry.rawUrl).then(setSpotifyMeta);
    } else {
      setSpotifyMeta(null);
    }
  }, [currentEntry]);

  const currentLabel = currentEntry
    ? currentEntry.kind === "spotify"
      ? spotifyMeta?.title || currentEntry.titleHint
      : titleCache[currentEntry.key] || currentTitle || currentEntry.titleHint
    : "Nothing playing";

  if (session?.user && !isVisible) {
    return null;
  }

  return (
    <>
      <div ref={playerMountRef} className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" aria-hidden="true" />
      <div className="fixed bottom-4 right-4 z-[9998] w-[min(92vw,24rem)]">
        <div className="overflow-hidden rounded-[1.75rem] border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(6,12,24,0.94),rgba(10,20,34,0.92),rgba(8,28,31,0.9))] shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 border-b border-cyan-300/15 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/75">Music Player</p>
              <div className="mt-1 flex items-center gap-2">
                <Music2 className="h-4 w-4 shrink-0 text-cyan-300" />
                <p className="truncate text-sm font-semibold text-cyan-50">{currentLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                onClick={() => setIsMinimized((prev) => !prev)}
              >
                {isMinimized ? "Open" : "Hide"}
              </button>
              <button
                type="button"
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/10"
                onClick={() => setIsManagerOpen((prev) => !prev)}
              >
                Queue
              </button>
            </div>
          </div>

          {/* --- Spotify Playlist Display --- */}
          {currentEntry?.kind === "spotify" && spotifyMeta ? (
            <div className="flex flex-col items-center gap-3 px-4 py-6">
              <img
                src={spotifyMeta.thumbnail}
                alt={spotifyMeta.title}
                className="mb-2 h-32 w-32 rounded-xl border border-green-300/40 bg-[#191414] object-cover shadow-lg"
              />
              <div className="text-center">
                <p className="text-lg font-bold text-green-200">{spotifyMeta.title}</p>
              </div>
              <a
                href={currentEntry.rawUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block rounded-full border border-green-400 bg-green-600/80 px-6 py-2 text-base font-semibold text-white shadow hover:bg-green-700/90"
              >
                Open in Spotify
              </a>
            </div>
          ) : null}

          {!isMinimized ? (
            <div className="space-y-4 px-4 py-4">
              <div className="rounded-[1.35rem] border border-cyan-300/20 bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-cyan-50">{currentLabel}</p>
                    <p className="mt-1 text-xs text-cyan-100/65">
                      {currentEntry
                        ? currentEntry.kind === "playlist"
                          ? "YouTube playlist"
                          : `Track ${currentIndex + 1} of ${queue.length}`
                        : session?.user
                          ? "Add some YouTube links to start the vibe."
                          : "Sign in to build your personal playlist."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/25 bg-white/5 text-cyan-100 hover:bg-white/10 disabled:opacity-40"
                      onClick={handlePrevious}
                      disabled={!currentEntry}
                      aria-label="Previous"
                    >
                      <SkipBack className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-cyan-300/45 bg-cyan-300/15 text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-40"
                      onClick={handleTogglePlayback}
                      disabled={!currentEntry}
                      aria-label={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                    </button>
                    <button
                      type="button"
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/25 bg-white/5 text-cyan-100 hover:bg-white/10 disabled:opacity-40"
                      onClick={handleNext}
                      disabled={!currentEntry}
                      aria-label="Next"
                    >
                      <SkipForward className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>


              {!isEditorMode ? (
                <div className="rounded-[1.35rem] border border-cyan-300/20 bg-black/20 p-3">
                  <label className="mb-2 block text-[11px] uppercase tracking-[0.24em] text-cyan-300/75">Music Player Editor</label>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25"
                    onClick={handleOpenMusicEditor}
                  >
                    <Plus className="h-4 w-4" />
                    Add Songs
                  </button>
                  <p className="mt-2 text-[11px] text-cyan-100/65">Manage your YouTube or Spotify playlists in the editor. This player uses the official YouTube embed API and keeps playback running while you scroll, switch pages, or hide this panel.</p>
                </div>
              ) : (
                <div className="rounded-[1.35rem] border border-cyan-300/20 bg-black/20 p-4">
                  <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-cyan-300/75">Add YouTube Links</label>
                  <textarea
                    className="min-h-20 w-full rounded-2xl border border-cyan-300/25 bg-black/35 px-4 py-3 text-cyan-50 outline-none transition focus:border-cyan-300/55"
                    placeholder="Paste YouTube video or playlist URLs, one per line"
                    value={editorInput}
                    onChange={(e) => setEditorInput(e.target.value)}
                  />
                  <label className="mb-2 mt-4 block text-xs uppercase tracking-[0.24em] text-green-300/75">Paste Spotify Playlist Link</label>
                  <input
                    className="w-full rounded-2xl border border-green-300/25 bg-black/35 px-4 py-2 text-green-100 outline-none transition focus:border-green-300/55"
                    placeholder="https://open.spotify.com/playlist/..."
                    value={spotifyInput}
                    onChange={(e) => setSpotifyInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="mt-2 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-60"
                    onClick={() => {
                      const rawItems = editorInput
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      let nextUrls = normalizeMusicPlayerUrls([...editorUrls, ...rawItems]);
                      if (spotifyInput.trim()) {
                        const match = SPOTIFY_PLAYLIST_REGEX.exec(spotifyInput.trim());
                        if (match) {
                          nextUrls = [...nextUrls, match[0]];
                        } else {
                          setStatus("Invalid Spotify playlist link.");
                          return;
                        }
                      }
                      if (!nextUrls.length) {
                        setStatus("Only valid YouTube or Spotify playlist URLs can be added.");
                        return;
                      }
                      setEditorUrls(nextUrls);
                      setEditorInput("");
                      setSpotifyInput("");
                      setStatus(null);
                    }}
                    disabled={editorSaving}
                  >
                    Add
                  </button>
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-semibold text-cyan-50">Your Playlist</p>
                    {editorUrls.length === 0 ? (
                      <p className="text-sm text-cyan-100/70">No songs saved yet.</p>
                    ) : (
                      editorUrls.map((url) => (
                        <div key={url} className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-black/25 px-3 py-2">
                          <p className="truncate text-sm text-cyan-100">{url}</p>
                          <button
                            type="button"
                            className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                            onClick={() => handleEditorRemove(url)}
                            disabled={editorSaving}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-60"
                      onClick={handleEditorSave}
                      disabled={editorSaving}
                    >
                      {editorSaving ? "Saving..." : "Save Playlist"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10"
                      onClick={handleEditorCancel}
                      disabled={editorSaving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {status ? <p className="text-xs text-cyan-200/80">{status}</p> : null}

              {!isManagerOpen && musicUrls.length > 0 ? (
                <div className="rounded-[1.35rem] border border-cyan-300/20 bg-black/15 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/80">Your Queue ({queue.length})</p>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-300/20"
                      onClick={() => setIsManagerOpen(true)}
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-2">
                    {queue.slice(0, 3).map((entry, index) => {
                      const label = titleCache[entry.key] || entry.titleHint;
                      const isDefault = entry.rawUrl === defaultPublicUrl;
                      return (
                        <button
                          key={entry.key}
                          type="button"
                          className="w-full truncate rounded-xl border border-cyan-300/12 bg-slate-950/45 px-3 py-2 text-left text-xs text-cyan-100 hover:border-cyan-300/30"
                          onClick={() => {
                            setCurrentIndex(index);
                            setIsPlaying(false);
                            loadedEntryKeyRef.current = null;
                            lastPersistedSecondRef.current = -1;
                            setCurrentTitle(label);
                          }}
                        >
                          {isDefault ? `${label} (Public)` : label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isManagerOpen ? (
                <div className="rounded-[1.35rem] border border-cyan-300/20 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-cyan-50">Your Chill Queue</p>
                      <p className="text-xs text-cyan-100/65">
                        {profileUsername ? `Saved to @${profileUsername}` : "Saved to your account"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/20 bg-white/5 p-2 text-white/85 hover:bg-white/10"
                      onClick={() => setIsManagerOpen(false)}
                      aria-label="Close queue manager"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {session?.user ? (
                    <>
                      <div className="space-y-2">
                        {queue.length === 0 ? (
                          <p className="text-xs text-cyan-100/60">No songs or playlists saved yet.</p>
                        ) : (
                          queue.map((entry, index) => {
                            const url = entry.rawUrl;
                            const label = titleCache[entry.key] || entry.titleHint;
                            const videoId = extractYoutubeVideoId(url);
                            const isDefault = url === defaultPublicUrl;
                            const mediaType = entry.kind === "spotify" ? "Spotify playlist" : videoId ? "YouTube video" : "YouTube playlist";
                            return (
                              <div key={entry.key} className="flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/12 bg-slate-950/55 px-3 py-2">
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => {
                                    setCurrentIndex(index);
                                    setIsPlaying(false);
                                    loadedEntryKeyRef.current = null;
                                    lastPersistedSecondRef.current = -1;
                                    setCurrentTitle(label);
                                  }}
                                >
                                  <p className="truncate text-sm font-medium text-cyan-50">{isDefault ? `${label} (Public)` : label}</p>
                                  <p className="truncate text-[11px] text-cyan-100/55">
                                    {mediaType}
                                  </p>
                                </button>
                                {isDefault ? (
                                  <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">Pinned</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                                    onClick={() => void removeSong(url)}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-cyan-100/70">Sign in to save your own playlist and keep it with you across the site.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}