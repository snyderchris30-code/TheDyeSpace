type ClientAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type ClientSessionLike = {
  user: ClientAuthUser;
} | null;

export type ResolvedClientAuth = {
  user: ClientAuthUser | null;
  session: ClientSessionLike;
  source: "session" | "user" | "none";
  errorMessage: string | null;
};

const CLIENT_AUTH_CACHE_TTL_MS = 5_000;
const CLIENT_PROFILE_CACHE_TTL_MS = 30_000;

const inFlightProfileInitByUserId = new Map<string, Promise<unknown>>();
const cachedProfilePromiseByKey = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
let cachedResolvedClientAuth: { expiresAt: number; value: ResolvedClientAuth } | null = null;
let inFlightResolvedClientAuth: Promise<ResolvedClientAuth> | null = null;

function formatClientAuthError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return error ? String(error) : null;
}

export async function resolveClientAuth(supabase: {
  auth: {
    getSession: () => Promise<any>;
    getUser: () => Promise<any>;
  };
}): Promise<ResolvedClientAuth> {
  const now = Date.now();
  if (cachedResolvedClientAuth && cachedResolvedClientAuth.expiresAt > now) {
    return cachedResolvedClientAuth.value;
  }

  if (inFlightResolvedClientAuth) {
    return inFlightResolvedClientAuth;
  }

  const authPromise = (async (): Promise<ResolvedClientAuth> => {
  let lastError: unknown = null;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.user) {
      const resolvedAuth: ResolvedClientAuth = {
        user: data.session.user as ClientAuthUser,
        session: data.session as ClientSessionLike,
        source: "session",
        errorMessage: null,
      };

      cachedResolvedClientAuth = {
        expiresAt: Date.now() + CLIENT_AUTH_CACHE_TTL_MS,
        value: resolvedAuth,
      };

      return resolvedAuth;
    }

    if (error) {
      lastError = error;
    }
  } catch (error) {
    lastError = error;
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data?.user) {
      const resolvedAuth: ResolvedClientAuth = {
        user: data.user as ClientAuthUser,
        session: { user: data.user as ClientAuthUser },
        source: "user",
        errorMessage: formatClientAuthError(lastError),
      };

      cachedResolvedClientAuth = {
        expiresAt: Date.now() + CLIENT_AUTH_CACHE_TTL_MS,
        value: resolvedAuth,
      };

      return resolvedAuth;
    }

    if (error) {
      lastError = error;
    }
  } catch (error) {
    lastError = error;
  }

  const resolvedAuth: ResolvedClientAuth = {
    user: null,
    session: null,
    source: "none",
    errorMessage: formatClientAuthError(lastError),
  };

  cachedResolvedClientAuth = {
    expiresAt: Date.now() + CLIENT_AUTH_CACHE_TTL_MS,
    value: resolvedAuth,
  };

  return resolvedAuth;
  })();

  inFlightResolvedClientAuth = authPromise;
  try {
    return await authPromise;
  } finally {
    if (inFlightResolvedClientAuth === authPromise) {
      inFlightResolvedClientAuth = null;
    }
  }
}

export async function fetchClientProfile<T>(
  supabase: any,
  userId: string,
  columns: string,
  options: { ensureProfile?: boolean } = {}
): Promise<T | null> {
  const cacheKey = `${userId}|${columns}|${options.ensureProfile ? "ensure" : "optional"}`;
  const cachedEntry = cachedProfilePromiseByKey.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.promise as Promise<T | null>;
  }

  if (cachedEntry) {
    cachedProfilePromiseByKey.delete(cacheKey);
  }

  const profilePromise = (async () => {
    let lastError: unknown = null;

    const loadProfile = async () => {
      const { data, error } = await supabase.from("profiles").select(columns).eq("id", userId).limit(1).maybeSingle();

      if (error) {
        throw error;
      }

      return (data as T | null) ?? null;
    };

    let profile: T | null = null;

    try {
      profile = await loadProfile();
      if (profile) {
        return profile;
      }
    } catch (error) {
      lastError = error;
    }

    if (!options.ensureProfile) {
      if (lastError) {
        throw lastError;
      }

      return profile;
    }

    let initPromise = inFlightProfileInitByUserId.get(userId) as Promise<unknown> | undefined;
    if (!initPromise) {
      const nextInitPromise = (async () => {
        const response = await fetch("/api/profile/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const initMessage = typeof body?.error === "string" ? body.error : "Failed to initialize profile.";
          throw new Error(initMessage);
        }

        return response.json().catch(() => ({}));
      })();

      inFlightProfileInitByUserId.set(userId, nextInitPromise);
      initPromise = nextInitPromise;
    }

    try {
      const initResult = (await initPromise) as { profile?: T | null };
      if (initResult?.profile) {
        return initResult.profile;
      }
    } catch (initError) {
      lastError = initError;
      try {
        profile = await loadProfile();
        if (profile) {
          return profile;
        }
      } catch {
        // Keep the original init error if re-load also fails.
      }
    } finally {
      if (inFlightProfileInitByUserId.get(userId) === initPromise) {
        inFlightProfileInitByUserId.delete(userId);
      }
    }

    try {
      profile = await loadProfile();
    } catch (error) {
      lastError = error;
    }

    if (!profile && lastError) {
      throw lastError;
    }

    return profile;
  })();

  cachedProfilePromiseByKey.set(cacheKey, {
    expiresAt: Date.now() + CLIENT_PROFILE_CACHE_TTL_MS,
    promise: profilePromise as Promise<unknown>,
  });
  profilePromise.catch(() => cachedProfilePromiseByKey.delete(cacheKey));
  return profilePromise;

}