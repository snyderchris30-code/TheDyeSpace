export type ProfileLookupResponse<T = unknown> = {
  profile: T | null;
  error?: string | null;
};

const PROFILE_LOOKUP_CACHE_TTL_MS = 30_000;

type CachedProfileLookupResponse = {
  expiresAt: number;
  value: ProfileLookupResponse;
};

const profileLookupCache = new Map<string, Promise<ProfileLookupResponse>>();
const resolvedProfileLookupCache = new Map<string, CachedProfileLookupResponse>();

export async function fetchProfileLookupByUsername<T = unknown>(
  username: string,
  signal?: AbortSignal
): Promise<ProfileLookupResponse<T>> {
  const key = username.trim().toLowerCase();
  if (!key) {
    return { profile: null };
  }

  const cached = resolvedProfileLookupCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as ProfileLookupResponse<T>;
  }

  if (cached) {
    resolvedProfileLookupCache.delete(key);
  }

  const existing = profileLookupCache.get(key);
  if (existing) {
    return existing as Promise<ProfileLookupResponse<T>>;
  }

  const promise = (async (): Promise<ProfileLookupResponse<T>> => {
    const response = await fetch(`/api/profile/lookup?username=${encodeURIComponent(username)}`, {
      cache: "no-store",
      signal,
    });

    const body = (await response.json().catch(() => ({}))) as ProfileLookupResponse<T>;
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : "Could not load this profile right now.");
    }

    resolvedProfileLookupCache.set(key, {
      expiresAt: Date.now() + PROFILE_LOOKUP_CACHE_TTL_MS,
      value: body,
    });

    return body;
  })();

  profileLookupCache.set(key, promise);
  promise.finally(() => {
    if (profileLookupCache.get(key) === promise) {
      profileLookupCache.delete(key);
    }
  });

  return promise;
}
