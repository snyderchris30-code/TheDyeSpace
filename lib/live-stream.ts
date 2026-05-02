import { buildYoutubeEmbedUrl, extractYoutubeVideoId } from "@/lib/youtube-media";

export type LiveThemeSettings = {
  live_status?: "live" | "offline" | null;
  live_title?: string | null;
  live_started_at?: string | null;
  live_youtube_url?: string | null;
  live_webrtc_requested?: boolean | null;
};

export type LiveSessionSummary = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  title: string;
  startedAt: string;
  youtubeUrl: string | null;
  youtubeEmbedUrl: string | null;
  webrtcRequested: boolean;
};

export function normalizeLiveTitle(value: unknown) {
  if (typeof value !== "string") return "Live Stream";
  const trimmed = value.trim();
  if (!trimmed) return "Live Stream";
  return trimmed.slice(0, 120);
}

export function normalizeLiveYoutubeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const videoId = extractYoutubeVideoId(trimmed);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildLiveYoutubeEmbedUrl(youtubeUrl?: string | null) {
  if (!youtubeUrl) return null;
  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) return null;
  return buildYoutubeEmbedUrl(videoId);
}

export function readLiveThemeSettings(value: unknown): LiveThemeSettings {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  return {
    live_status: candidate.live_status === "live" ? "live" : candidate.live_status === "offline" ? "offline" : null,
    live_title: typeof candidate.live_title === "string" ? candidate.live_title : null,
    live_started_at: typeof candidate.live_started_at === "string" ? candidate.live_started_at : null,
    live_youtube_url: typeof candidate.live_youtube_url === "string" ? candidate.live_youtube_url : null,
    live_webrtc_requested: candidate.live_webrtc_requested === true,
  };
}
