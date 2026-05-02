"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dedupeApiFetchJson } from "@/lib/dedupe-fetch";
import type { LiveSessionSummary } from "@/lib/live-stream";
import { createClient } from "@/lib/supabase/client";

type LiveSessionResponse = {
  session?: LiveSessionSummary | null;
  error?: string;
};

type LiveChatMessage = {
  id: string;
  hostUserId: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  message: string;
  createdAt: string;
};

type LiveChatResponse = {
  messages?: LiveChatMessage[];
  error?: string;
};

async function fetchSessionByUserId(profileUserId: string) {
  const body = await dedupeApiFetchJson<LiveSessionResponse>(`/api/live/sessions?userId=${encodeURIComponent(profileUserId)}`, {
    cache: "no-store",
  });

  if (body?.error) {
    throw new Error(body.error);
  }

  return body.session || null;
}

async function fetchLiveChat(hostUserId: string) {
  const body = await dedupeApiFetchJson<LiveChatResponse>(`/api/live/chat?hostUserId=${encodeURIComponent(hostUserId)}`, {
    cache: "no-store",
  });

  if (body?.error) {
    throw new Error(body.error);
  }

  return body.messages || [];
}

export default function ProfileLiveStreamPanel({
  profileUserId,
  profileIsVerified,
  isOwner,
}: {
  profileUserId: string | null;
  profileIsVerified: boolean;
  isOwner: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [liveTitleInput, setLiveTitleInput] = useState("Live With The Dye Crew");
  const [youtubeLiveUrlInput, setYoutubeLiveUrlInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [localStreamReady, setLocalStreamReady] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const { data: liveSession, refetch: refetchLiveSession } = useQuery({
    queryKey: ["profileLiveSession", profileUserId],
    queryFn: () => fetchSessionByUserId(profileUserId || ""),
    enabled: Boolean(profileUserId),
    staleTime: 1000 * 5,
    refetchInterval: 1000 * 10,
  });

  const { data: chatMessages = [], refetch: refetchLiveChat } = useQuery({
    queryKey: ["profileLiveChat", profileUserId],
    queryFn: () => fetchLiveChat(profileUserId || ""),
    enabled: Boolean(profileUserId && liveSession),
    staleTime: 1000 * 2,
    refetchInterval: 1000 * 5,
  });

  useEffect(() => {
    void supabase.auth.getUser().then((result: { data: { user: { id: string } | null } }) => {
      setSessionUserId(result.data?.user?.id || null);
    });
  }, [supabase]);

  const stopLocalPreview = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setLocalStreamReady(false);
  }, []);

  useEffect(() => {
    return () => {
      stopLocalPreview();
    };
  }, [stopLocalPreview]);

  const handleStartLive = useCallback(async () => {
    if (!isOwner || !profileIsVerified) {
      setStreamStatus("Only verified profile owners can go live.");
      return;
    }

    setIsStarting(true);
    setStreamStatus(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setLocalStreamReady(true);

      const response = await fetch("/api/live/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: liveTitleInput,
          youtubeUrl: youtubeLiveUrlInput || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to start live session.");
      }

      setStreamStatus("Live session started.");
      void refetchLiveSession();
    } catch (error: any) {
      stopLocalPreview();
      setStreamStatus(typeof error?.message === "string" ? error.message : "Could not access camera/mic.");
    } finally {
      setIsStarting(false);
    }
  }, [isOwner, liveTitleInput, profileIsVerified, refetchLiveSession, stopLocalPreview, youtubeLiveUrlInput]);

  const handleStopLive = useCallback(async () => {
    setIsStopping(true);
    setStreamStatus(null);

    try {
      const response = await fetch("/api/live/sessions", { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to stop live session.");
      }

      stopLocalPreview();
      setStreamStatus("Live session ended.");
      void refetchLiveSession();
    } catch (error: any) {
      setStreamStatus(typeof error?.message === "string" ? error.message : "Failed to stop live session.");
    } finally {
      setIsStopping(false);
    }
  }, [refetchLiveSession, stopLocalPreview]);

  const handleSendChat = useCallback(async () => {
    if (!profileUserId) return;
    if (!sessionUserId) {
      setChatStatus("Sign in to chat in live streams.");
      return;
    }

    const message = chatDraft.trim();
    if (!message) return;

    setChatStatus(null);
    const response = await fetch("/api/live/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostUserId: profileUserId, message }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setChatStatus(body?.error || "Failed to send message.");
      return;
    }

    setChatDraft("");
    void refetchLiveChat();
  }, [chatDraft, profileUserId, refetchLiveChat, sessionUserId]);

  if (!profileIsVerified && !liveSession) {
    return null;
  }

  return (
    <section className="mt-8 rounded-[1.75rem] border border-rose-300/25 bg-[linear-gradient(180deg,rgba(127,29,29,0.18),rgba(2,6,23,0.78))] p-6 shadow-xl backdrop-blur-xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-rose-200/85">Live Streaming</p>
          <h2 className="mt-2 text-2xl font-black text-rose-50">Direct Browser Live</h2>
        </div>
        {liveSession ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-red-200/60 bg-red-600 px-4 py-1 text-sm font-black uppercase tracking-[0.2em] text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
        ) : null}
      </div>

      {isOwner && profileIsVerified ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-rose-300/20 bg-black/20 p-4">
          <p className="text-sm text-rose-100/90">
            WebRTC camera capture is active for your local preview. Multi-peer relay signaling is staged, and YouTube Live is the fallback until full direct browser distribution ships.
          </p>
          <input
            value={liveTitleInput}
            onChange={(event) => setLiveTitleInput(event.target.value)}
            maxLength={120}
            placeholder="Live stream title"
            className="w-full rounded-xl border border-rose-200/30 bg-black/30 px-4 py-2 text-sm text-rose-50 outline-none focus:border-rose-200/60"
          />
          <input
            value={youtubeLiveUrlInput}
            onChange={(event) => setYoutubeLiveUrlInput(event.target.value)}
            placeholder="Optional YouTube Live URL fallback"
            className="w-full rounded-xl border border-rose-200/30 bg-black/30 px-4 py-2 text-sm text-rose-50 outline-none focus:border-rose-200/60"
          />
          <div className="flex flex-wrap items-center gap-3">
            {!liveSession ? (
              <button
                type="button"
                className="rounded-full border border-red-200/60 bg-red-600 px-5 py-2 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-red-500 disabled:opacity-60"
                onClick={() => void handleStartLive()}
                disabled={isStarting}
              >
                {isStarting ? "Starting..." : "Go Live"}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-full border border-rose-200/40 bg-black/40 px-5 py-2 text-sm font-semibold text-rose-50 transition hover:bg-black/60 disabled:opacity-60"
                onClick={() => void handleStopLive()}
                disabled={isStopping}
              >
                {isStopping ? "Stopping..." : "End Live"}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-2xl border border-rose-200/25 bg-black/35">
          {liveSession?.youtubeEmbedUrl ? (
            <iframe
              src={liveSession.youtubeEmbedUrl}
              title={liveSession.title}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
            />
          ) : localStreamReady ? (
            <video ref={videoRef} className="aspect-video w-full bg-black" autoPlay muted playsInline />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.25),transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.92),rgba(2,6,23,0.98))] p-6 text-center">
              <div>
                <p className="text-lg font-bold text-rose-50">Live streaming coming soon</p>
                <p className="mt-2 text-sm text-rose-100/80">
                  Direct browser WebRTC relay is being rolled out. Verified users can use YouTube Live as fallback right now.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-2xl border border-rose-200/25 bg-black/25">
          <div className="border-b border-rose-200/20 px-4 py-3 text-sm font-semibold text-rose-100">Live Chat</div>
          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {chatMessages.length === 0 ? (
              <p className="text-sm text-rose-100/65">No chat yet. Say hi to start the stream conversation.</p>
            ) : (
              chatMessages.map((message) => (
                <div key={message.id} className="rounded-xl border border-rose-200/20 bg-black/25 px-3 py-2">
                  <p className="text-xs font-semibold text-rose-100">{message.displayName || message.username || "User"}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-rose-50/95">{message.message}</p>
                </div>
              ))
            )}
          </div>
          <div className="mt-auto border-t border-rose-200/20 p-3">
            <div className="flex items-center gap-2">
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value)}
                placeholder={sessionUserId ? "Send a message" : "Sign in to chat"}
                disabled={!sessionUserId}
                maxLength={400}
                className="w-full rounded-xl border border-rose-200/25 bg-black/25 px-3 py-2 text-sm text-rose-50 outline-none focus:border-rose-200/50 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <button
                type="button"
                onClick={() => void handleSendChat()}
                disabled={!sessionUserId || !chatDraft.trim()}
                className="rounded-xl border border-rose-200/45 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
              >
                Send
              </button>
            </div>
            {chatStatus ? <p className="mt-2 text-xs text-rose-100/80">{chatStatus}</p> : null}
          </div>
        </div>
      </div>

      {streamStatus ? <p className="mt-3 text-sm text-rose-100/85">{streamStatus}</p> : null}
    </section>
  );
}
