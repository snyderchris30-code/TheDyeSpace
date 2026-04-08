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
  const loadProfile = async () => {
    const { data, error } = await supabase.from("profiles").select(columns).eq("id", userId).limit(1).maybeSingle();

    if (error) {
      throw error;
    }

    return (data as T | null) ?? null;
  };

  let profile = await loadProfile();
  if (!profile && options.ensureProfile) {
    const response = await fetch("/api/profile/init", { method: "POST" });
    if (response.ok) {
      profile = await loadProfile();
    }
  }

  return profile;
}