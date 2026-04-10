import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type NotificationRow = {
  id: string;
  actor_name: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  post_id?: string | null;
};

type PatchBody = {
  notificationId?: string;
  markAll?: boolean;
};

type RequestContext = {
  requestId: string;
  sessionClient: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string | null;
};

function getRequestId(req: NextRequest) {
  return req.headers.get("x-vercel-id") || randomUUID();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const enrichedError = error as Error & {
      code?: string;
      details?: string;
      hint?: string;
      status?: number;
    };

    return {
      name: enrichedError.name,
      message: enrichedError.message,
      code: enrichedError.code ?? null,
      details: enrichedError.details ?? null,
      hint: enrichedError.hint ?? null,
      status: enrichedError.status ?? null,
      stack: enrichedError.stack ?? null,
    };
  }

  if (typeof error === "object" && error !== null) {
    return error;
  }

  return { message: String(error) };
}

function isMissingSessionAuthError(error: unknown) {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name || "") : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return name === "AuthSessionMissingError" || /auth session missing|session.*missing/i.test(message);
}

function isMissingPostIdColumnError(error: unknown) {
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return message.includes("Could not find the 'post_id' column of 'notifications' in the schema cache");
}

function normalizeNotificationRow(row: Partial<NotificationRow> | null | undefined): NotificationRow {
  const actorName = typeof row?.actor_name === "string" && row.actor_name.trim() ? row.actor_name : "someone";
  const type = typeof row?.type === "string" && row.type.trim() ? row.type : "activity";
  const createdAt = typeof row?.created_at === "string" && row.created_at ? row.created_at : new Date(0).toISOString();
  const message = typeof row?.message === "string" && row.message.trim()
    ? row.message
    : `${actorName} interacted with your account.`;

  return {
    id: typeof row?.id === "string" && row.id ? row.id : `unknown-${type}-${createdAt}`,
    actor_name: actorName,
    type,
    message,
    read: row?.read === true,
    created_at: createdAt,
    post_id: typeof row?.post_id === "string" ? row.post_id : null,
  };
}

function normalizeNotificationRows(rows: unknown) {
  if (!Array.isArray(rows)) {
    return [] as NotificationRow[];
  }

  return rows.map((row) => normalizeNotificationRow(row as Partial<NotificationRow>));
}

function createEmptyNotificationsResponse(authenticated = false) {
  return NextResponse.json({ notifications: [], unreadCount: 0, authenticated });
}

function getNotificationDbClient(
  sessionClient: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestId: string,
  purpose: "read" | "write"
) {
  return {
    client: sessionClient,
    clientType: "session" as const,
  };
}

async function getRequestContext(req: NextRequest, requestId: string): Promise<RequestContext> {
  const sessionClient = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();

  if (authError) {
    if (isMissingSessionAuthError(authError)) {
      console.info("[notifications] Anonymous request", {
        requestId,
        method: req.method,
      });

      return {
        requestId,
        sessionClient,
        userId: null,
      };
    }

    console.error("[notifications] Failed to resolve authenticated user", {
      requestId,
      method: req.method,
      error: serializeError(authError),
    });
    throw authError;
  }

  return {
    requestId,
    sessionClient,
    userId: user?.id || null,
  };
}

async function parsePatchBody(req: NextRequest, requestId: string): Promise<PatchBody | null> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }

    return body as PatchBody;
  } catch (error) {
    console.warn("[notifications] Invalid PATCH body", {
      requestId,
      error: serializeError(error),
    });
    return null;
  }
}

async function readNotificationsForUser(
  userId: string,
  sessionClient: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestId: string
) {
  const { client, clientType } = getNotificationDbClient(sessionClient, requestId, "read");

  const withPostId = await client
    .from("notifications")
    .select("id, actor_name, type, message, read, created_at, post_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!withPostId.error) {
    return {
      notifications: normalizeNotificationRows(withPostId.data),
      usedFallback: false,
      clientType,
    };
  }

  const cacheError = isMissingPostIdColumnError(withPostId.error);

  if (!cacheError) {
    throw withPostId.error;
  }

  console.warn("[notifications] Falling back to notifications query without post_id", {
    requestId,
    userId,
    clientType,
    error: serializeError(withPostId.error),
  });

  const fallback = await client
    .from("notifications")
    .select("id, actor_name, type, message, read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (fallback.error) {
    throw fallback.error;
  }

  return {
    notifications: normalizeNotificationRows(fallback.data).map((item) => ({
      ...item,
      post_id: null,
    })),
    usedFallback: true,
    clientType,
  };
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  try {
    const { sessionClient, userId } = await getRequestContext(req, requestId);

    if (!userId) {
      return createEmptyNotificationsResponse(false);
    }

    const { notifications, usedFallback, clientType } = await readNotificationsForUser(
      userId,
      sessionClient,
      requestId
    );
    const unreadCount = notifications.reduce((count, item) => (item.read ? count : count + 1), 0);

    console.info("[notifications] Loaded notifications", {
      requestId,
      userId,
      count: notifications.length,
      unreadCount,
      usedFallback,
      clientType,
    });

    return NextResponse.json({ notifications, unreadCount, authenticated: true });
  } catch (error: any) {
    console.error("[notifications] Failed to load notifications", {
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
      error: serializeError(error),
    });
    return createEmptyNotificationsResponse(false);
  }
}

export async function PATCH(req: NextRequest) {
  const requestId = getRequestId(req);
  try {
    const { sessionClient, userId } = await getRequestContext(req, requestId);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parsePatchBody(req, requestId);
    if (body === null) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { client, clientType } = getNotificationDbClient(sessionClient, requestId, "write");

    if (body.markAll) {
      const { data, error } = await client
        .from("notifications")
        .update({ read: true })
        .eq("user_id", userId)
        .eq("read", false)
        .select("id");

      if (error) {
        throw error;
      }

      console.info("[notifications] Marked all notifications as read", {
        requestId,
        userId,
        updatedCount: Array.isArray(data) ? data.length : 0,
        clientType,
      });
      return NextResponse.json({ ok: true, updatedCount: Array.isArray(data) ? data.length : 0 });
    }

    const notificationId = typeof body.notificationId === "string" ? body.notificationId.trim() : "";

    if (!notificationId) {
      return NextResponse.json({ error: "notificationId is required." }, { status: 400 });
    }

    const { data, error } = await client
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .eq("read", false)
      .select("id");

    if (error) {
      throw error;
    }

    console.info("[notifications] Marked notification as read", {
      requestId,
      userId,
      notificationId,
      updated: Array.isArray(data) && data.length > 0,
      clientType,
    });

    return NextResponse.json({ ok: true, updated: Array.isArray(data) && data.length > 0 });
  } catch (error: any) {
    console.error("[notifications] Failed to update notifications", {
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
      error: serializeError(error),
    });
    return NextResponse.json({ ok: false, error: typeof error?.message === "string" ? error.message : "Failed to update notifications." });
  }
}