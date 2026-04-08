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
  let lastError: unknown = null;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.user) {
      return {
        user: data.session.user as ClientAuthUser,
        session: data.session as ClientSessionLike,
        source: "session",
        errorMessage: null,
      };
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
      return {
        user: data.user as ClientAuthUser,
        session: { user: data.user as ClientAuthUser },
        source: "user",
        errorMessage: formatClientAuthError(lastError),
      };
    }

    if (error) {
      lastError = error;
    }
  } catch (error) {
    lastError = error;
  }

  return {
    user: null,
    session: null,
    source: "none",
    errorMessage: formatClientAuthError(lastError),
  };
}

export async function fetchClientProfile<T>(
  supabase: any,
  userId: string,
  columns: string,
  options: { ensureProfile?: boolean } = {}
): Promise<T | null> {
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

  const response = await fetch("/api/profile/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const initMessage = typeof body?.error === "string" ? body.error : "Failed to initialize profile.";

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error(initMessage);
  }

  const body = await response.json().catch(() => ({}));
  if (body?.profile) {
    return body.profile as T;
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
}