function toUtcDateStamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date().toISOString().slice(0, 10);
}

function hashSeedToCounter(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 10_000;
  }

  const counter = (Math.abs(hash) % 99) + 1;
  return String(counter).padStart(2, "0");
}

const buildDate = toUtcDateStamp(process.env.NEXT_PUBLIC_BUILD_DATE ?? "");
const buildSeed = process.env.NEXT_PUBLIC_BUILD_SEED ?? buildDate;
const versionDate = buildDate.replace(/-/g, ".");
const buildCounter = hashSeedToCounter(buildSeed);

export const APP_VERSION = `v${versionDate}-${buildCounter}`;

export function withVersionParam(pathOrUrl: string) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://local.app";
  const url = new URL(pathOrUrl, base);
  url.searchParams.set("v", APP_VERSION);

  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export const INVITE_EXPIRATION_DEFAULT_HOURS = 12;
export const INVITE_EXPIRATION_OPTIONS_HOURS = [1, 12, 24, 168] as const;

// Public default song shown to all users in the global homepage player.
// Change this URL/title to update the pinned default track.
export const DEFAULT_PUBLIC_MUSIC_URL = "https://youtu.be/7S8wllPmazM?si=uXed4emZW4N8A4Zi";
export const DEFAULT_PUBLIC_MUSIC_TITLE = "Default Public Song";

export function formatInviteDurationLabel(hours: number) {
  if (hours === 1) return "1 hour";
  if (hours === 168) return "7 days";
  return `${hours} hours`;
}
