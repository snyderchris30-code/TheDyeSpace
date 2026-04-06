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

async function readNotificationsForUser(userId: string) {
  const supabase = await createSupabaseServerClient();

  const withPostId = await supabase
    .from("notifications")
    .select("id, actor_name, type, message, read, created_at, post_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (!withPostId.error) {
    return {
      notifications: (withPostId.data || []) as NotificationRow[],
      usedFallback: false,
    };
  }

  const cacheError = String(withPostId.error.message || "").includes(
    "Could not find the 'post_id' column of 'notifications' in the schema cache"
  );

  if (!cacheError) {
    throw withPostId.error;
  }

  const fallback = await supabase
    .from("notifications")
    .select("id, actor_name, type, message, read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (fallback.error) {
    throw fallback.error;
  }

  return {
    notifications: ((fallback.data || []) as NotificationRow[]).map((item) => ({
      ...item,
      post_id: null,
    })),
    usedFallback: true,
  };
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { notifications, usedFallback } = await readNotificationsForUser(user.id);
    const unreadCount = notifications.reduce((count, item) => (item.read ? count : count + 1), 0);

    console.info("[notifications] Loaded notifications", {
      userId: user.id,
      count: notifications.length,
      unreadCount,
      usedFallback,
    });

    return NextResponse.json({ notifications, unreadCount });
  } catch (error: any) {
    console.error("[notifications] Failed to load notifications", {
      error: error?.message || error,
    });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load notifications." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { notificationId?: string; markAll?: boolean };

    if (body.markAll) {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);

      if (error) {
        throw error;
      }

      console.info("[notifications] Marked all notifications as read", { userId: user.id });
      return NextResponse.json({ ok: true });
    }

    if (!body.notificationId) {
      return NextResponse.json({ error: "notificationId is required." }, { status: 400 });
    }

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", body.notificationId)
      .eq("user_id", user.id);

    if (error) {
      throw error;
    }

    console.info("[notifications] Marked notification as read", {
      userId: user.id,
      notificationId: body.notificationId,
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[notifications] Failed to update notifications", {
      error: error?.message || error,
    });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to update notifications." },
      { status: 500 }
    );
  }
}