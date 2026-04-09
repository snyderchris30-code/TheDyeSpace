export type MusicQueueEntry = {
  rawUrl: string;
  kind: "video" | "playlist";
  key: string;
  videoId?: string;
  playlistId?: string;
  titleHint: string;
};

const YOUTUBE_VIDEO_URL_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const YOUTUBE_PLAYLIST_URL_REGEX = /[?&]list=([a-zA-Z0-9_-]+)/;

export function extractYoutubeVideoId(url: string) {
  const match = url.match(YOUTUBE_VIDEO_URL_REGEX);
  return match ? match[1] : null;
}

export function extractYoutubePlaylistId(url: string) {
  const match = url.match(YOUTUBE_PLAYLIST_URL_REGEX);
  return match ? match[1] : null;
}

export function normalizeYoutubeVideoUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const uniqueUrls = new Set<string>();

  for (const rawValue of input) {
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;

    const videoId = extractYoutubeVideoId(trimmed);
    if (!videoId) continue;

    uniqueUrls.add(`https://www.youtube.com/watch?v=${videoId}`);
    if (uniqueUrls.size >= 25) {
      break;
    }
  }

  return Array.from(uniqueUrls);
}

export function normalizeMusicPlayerUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const uniqueUrls = new Set<string>();

  for (const rawValue of input) {
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;

    const playlistId = extractYoutubePlaylistId(trimmed);
    if (playlistId) {
      uniqueUrls.add(`https://www.youtube.com/playlist?list=${playlistId}`);
      if (uniqueUrls.size >= 25) {
        break;
      }
      continue;
    }

    const videoId = extractYoutubeVideoId(trimmed);
    if (!videoId) continue;

    uniqueUrls.add(`https://www.youtube.com/watch?v=${videoId}`);
    if (uniqueUrls.size >= 25) {
      break;
    }
  }

  return Array.from(uniqueUrls);
}

const DEFAULT_YOUTUBE_EMBED_ORIGIN = "https://www.thedyespace.app";

export function resolveYoutubeEmbedOrigin(origin?: string | null) {
  const candidateOrigin = origin ?? (typeof window !== "undefined" ? window.location.origin : DEFAULT_YOUTUBE_EMBED_ORIGIN);
  if (!candidateOrigin) {
    return DEFAULT_YOUTUBE_EMBED_ORIGIN;
  }

  try {
    const parsedOrigin = new URL(candidateOrigin);
    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
      return DEFAULT_YOUTUBE_EMBED_ORIGIN;
    }

    return parsedOrigin.origin;
  } catch {
    return DEFAULT_YOUTUBE_EMBED_ORIGIN;
  }
}

export function buildYoutubeEmbedUrl(
  videoId: string,
  options: {
    origin?: string | null;
    enableJsApi?: boolean;
    privacyEnhanced?: boolean;
  } = {}
) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });

  if (options.enableJsApi) {
    params.set("enablejsapi", "1");
  }

  const safeOrigin = resolveYoutubeEmbedOrigin(options.origin);
  if (safeOrigin) {
    params.set("origin", safeOrigin);
  }

  const host = options.privacyEnhanced === false ? "https://www.youtube.com" : "https://www.youtube-nocookie.com";
  return `${host}/embed/${videoId}?${params.toString()}`;
}

export function buildMusicQueue(urls: string[]): MusicQueueEntry[] {
  const queue: MusicQueueEntry[] = [];

  normalizeMusicPlayerUrls(urls).forEach((url, index) => {
    const playlistId = extractYoutubePlaylistId(url);
    if (playlistId) {
      queue.push({
        rawUrl: url,
        kind: "playlist",
        key: `playlist:${playlistId}`,
        playlistId,
        titleHint: `Playlist ${index + 1}`,
      });
      return;
    }

    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      return;
    }

    queue.push({
      rawUrl: url,
      kind: "video",
      key: `video:${videoId}`,
      videoId,
      titleHint: `Track ${index + 1}`,
    });
  });

  return queue;
}