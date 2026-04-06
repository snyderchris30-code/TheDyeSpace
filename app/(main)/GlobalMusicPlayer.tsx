"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause, Play, Plus, SkipBack, SkipForward, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buildMusicQueue, extractYoutubeVideoId, normalizeMusicPlayerUrls, type MusicQueueEntry } from "@/lib/youtube-media";

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
  const currentEntryRef = useRef<MusicQueueEntry | null>(null);
  const queueLengthRef = useRef(0);
  const [session, setSession] = useState<any>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [musicUrls, setMusicUrls] = useState<string[]>([]);
  const [isApiReady, setIsApiReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [songInput, setSongInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTitle, setCurrentTitle] = useState("Nothing playing");
  const [titleCache, setTitleCache] = useState<Record<string, string>>({});

  const queue = useMemo(() => buildMusicQueue(musicUrls), [musicUrls]);
  const currentEntry = queue[currentIndex] ?? null;

  useEffect(() => {
    currentEntryRef.current = currentEntry;
    queueLengthRef.current = queue.length;
  }, [currentEntry, queue.length]);

  const loadProfileMusic = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, theme_settings")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setStatus(error.message || "Could not load your playlist.");
        setMusicUrls([]);
        return;
      }

      const nextUrls = normalizeMusicPlayerUrls(
        Array.isArray((data?.theme_settings as { music_player_urls?: string[] | null } | null)?.music_player_urls)
          ? ((data?.theme_settings as { music_player_urls?: string[] | null }).music_player_urls as string[])
          : []
      );

      setProfileUsername(data?.username || null);
      setMusicUrls(nextUrls);
      setCurrentIndex((prev) => {
        if (!nextUrls.length) return 0;
        return Math.min(prev, nextUrls.length - 1);
      });
      setStatus(null);
    },
    [supabase]
  );

  const persistPlaylist = useCallback(async (nextUrls: string[], successMessage?: string) => {
    setIsSaving(true);
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

      setMusicUrls(nextUrls);
      setCurrentIndex((prev) => {
        if (!nextUrls.length) return 0;
        return Math.min(prev, nextUrls.length - 1);
      });
      setStatus(successMessage || "Playlist saved.");
    } catch (error: any) {
      setStatus(typeof error?.message === "string" ? error.message : "Could not save your playlist.");
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    ensureYouTubeApi(() => setIsApiReady(true));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const nextSession = data.session || null;
      setSession(nextSession);
      if (nextSession?.user?.id) {
        void loadProfileMusic(nextSession.user.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      if (nextSession?.user?.id) {
        void loadProfileMusic(nextSession.user.id);
        return;
      }

      setProfileUsername(null);
      setMusicUrls([]);
      setCurrentIndex(0);
      setCurrentTitle("Nothing playing");
      setIsPlaying(false);
      setStatus(null);
      if (playerRef.current && readyRef.current) {
        playerRef.current.stopVideo?.();
      }
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [loadProfileMusic, supabase]);

  useEffect(() => {
    if (!isApiReady || !playerMountRef.current || playerRef.current) {
      return;
    }

    playerRef.current = new window.YT.Player(playerMountRef.current, {
      width: "1",
      height: "1",
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          readyRef.current = true;
          setIsPlayerReady(true);
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
  }, [isApiReady]);

  useEffect(() => {
    if (!currentEntry || !isPlayerReady || !playerRef.current) {
      if (!queue.length) {
        setCurrentTitle("Nothing playing");
      }
      return;
    }

    if (loadedEntryKeyRef.current === currentEntry.key) {
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
      return;
    }

    if (currentEntry.kind === "video" && currentEntry.videoId) {
      if (isPlaying) {
        playerRef.current.loadVideoById(currentEntry.videoId);
      } else {
        playerRef.current.cueVideoById(currentEntry.videoId);
      }
      setCurrentTitle(titleCache[currentEntry.key] || currentEntry.titleHint);
    }
  }, [currentEntry, isPlayerReady, isPlaying, queue.length, titleCache]);

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
    if (!playerRef.current || !currentEntry) {
      return;
    }

    if (isPlaying) {
      playerRef.current.pauseVideo?.();
      setIsPlaying(false);
      return;
    }

    playerRef.current.playVideo?.();
    setIsPlaying(true);
  }, [currentEntry, isPlaying]);

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
  }, [currentEntry, queue.length]);

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
  }, [currentEntry, queue.length]);

  const addSongs = async () => {
    if (!session?.user) {
      setStatus("Sign in to build your playlist.");
      return;
    }

    const rawEntries = songInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!rawEntries.length) {
      setStatus("Paste at least one YouTube video or playlist URL.");
      return;
    }

    const nextUrls = normalizeMusicPlayerUrls([...(musicUrls || []), ...rawEntries]);
    if (!nextUrls.length) {
      setStatus("Only valid YouTube video or playlist URLs can be added.");
      return;
    }

    await persistPlaylist(nextUrls, `${nextUrls.length} saved to your playlist.`);
    setSongInput("");
  };

  const removeSong = async (url: string) => {
    const nextUrls = musicUrls.filter((item) => item !== url);
    await persistPlaylist(nextUrls, "Playlist updated.");
    if (currentEntry?.rawUrl === url) {
      loadedEntryKeyRef.current = null;
      setCurrentIndex(0);
      setCurrentTitle(nextUrls.length ? "Select play to resume." : "Nothing playing");
      setIsPlaying(false);
      playerRef.current?.pauseVideo?.();
    }
  };

  const currentLabel = currentEntry ? titleCache[currentEntry.key] || currentTitle || currentEntry.titleHint : "Nothing playing";

  return (
    <>
      <div ref={playerMountRef} className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" aria-hidden="true" />
      <div className="fixed bottom-4 right-4 z-[9998] w-[min(92vw,24rem)]">
        <div className="overflow-hidden rounded-[1.75rem] border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(6,12,24,0.94),rgba(10,20,34,0.92),rgba(8,28,31,0.9))] shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 border-b border-cyan-300/15 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-300/75">Home Player</p>
              <div className="mt-1 flex items-center gap-2">
                <Music2 className="h-4 w-4 shrink-0 text-cyan-300" />
                <p className="truncate text-sm font-semibold text-cyan-50">{currentLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/20"
                onClick={() => setIsCollapsed((prev) => !prev)}
              >
                {isCollapsed ? "Open" : "Hide"}
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

          {!isCollapsed ? (
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
                      disabled={!currentEntry || !isPlayerReady}
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

              {status ? <p className="text-xs text-cyan-200/80">{status}</p> : null}

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
                      <textarea
                        className="min-h-24 w-full rounded-2xl border border-cyan-300/20 bg-slate-950/80 px-4 py-3 text-sm text-cyan-50 outline-none transition focus:border-cyan-300/45"
                        placeholder="Paste YouTube video or playlist URLs, one per line"
                        value={songInput}
                        onChange={(event) => setSongInput(event.target.value)}
                      />
                      <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-60"
                        onClick={() => void addSongs()}
                        disabled={isSaving}
                      >
                        <Plus className="h-4 w-4" />
                        {isSaving ? "Saving..." : "Add To Queue"}
                      </button>

                      <div className="mt-4 space-y-2">
                        {musicUrls.length === 0 ? (
                          <p className="text-xs text-cyan-100/60">No songs or playlists saved yet.</p>
                        ) : (
                          musicUrls.map((url, index) => {
                            const entry = queue.find((item) => item.rawUrl === url);
                            const label = entry ? titleCache[entry.key] || entry.titleHint : `Item ${index + 1}`;
                            const videoId = extractYoutubeVideoId(url);
                            return (
                              <div key={url} className="flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/12 bg-slate-950/55 px-3 py-2">
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => {
                                    setCurrentIndex(index);
                                    setIsPlaying(false);
                                    loadedEntryKeyRef.current = null;
                                    setCurrentTitle(label);
                                  }}
                                >
                                  <p className="truncate text-sm font-medium text-cyan-50">{label}</p>
                                  <p className="truncate text-[11px] text-cyan-100/55">
                                    {videoId ? "YouTube video" : "YouTube playlist"}
                                  </p>
                                </button>
                                <button
                                  type="button"
                                  className="rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                                  onClick={() => void removeSong(url)}
                                >
                                  Remove
                                </button>
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