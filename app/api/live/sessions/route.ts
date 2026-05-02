import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";
import {
  buildLiveYoutubeEmbedUrl,
  normalizeLiveTitle,
  normalizeLiveYoutubeUrl,
  readLiveThemeSettings,
  type LiveSessionSummary,
} from "@/lib/live-stream";
import { clearLiveChatMessages } from "@/app/api/live/store";

type LiveSessionProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified_badge: boolean | null;
  theme_settings: Record<string, unknown> | null;
};

function toSessionSummary(row: LiveSessionProfileRow): LiveSessionSummary | null {
  if (row.verified_badge !== true) return null;
  const settings = readLiveThemeSettings(row.theme_settings);
  if (settings.live_status !== "live") return null;

  const startedAt = typeof settings.live_started_at === "string" && settings.live_started_at
    ? settings.live_started_at
    : new Date().toISOString();

  const youtubeUrl = normalizeLiveYoutubeUrl(settings.live_youtube_url);

  return {
    userId: row.id,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    title: normalizeLiveTitle(settings.live_title),
    startedAt,
    youtubeUrl,
    youtubeEmbedUrl: buildLiveYoutubeEmbedUrl(youtubeUrl),
    webrtcRequested: settings.live_webrtc_requested === true,
  };
}

export async function GET(req: NextRequest) {
  try {
    const adminClient = createAdminClient();
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId")?.trim() || null;
    const username = url.searchParams.get("username")?.trim().toLowerCase() || null;

    let query = adminClient
      .from("profiles")
      .select("id,username,display_name,avatar_url,verified_badge,theme_settings")
      .eq("verified_badge", true)
      .limit(userId || username ? 1 : 80);

    if (userId) {
      query = query.eq("id", userId);
    }

    if (username) {
      query = query.eq("username", username);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const rows = (data || []) as LiveSessionProfileRow[];
    const sessions = rows.map(toSessionSummary).filter((item): item is LiveSessionSummary => Boolean(item));

    if (userId || username) {
      return NextResponse.json({ session: sessions[0] || null });
    }

    sessions.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load live sessions." },
      { status: 500 }
    );
  }
}

type StartLiveBody = {
  title?: string;
  youtubeUrl?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,verified_badge,theme_settings,username,display_name,avatar_url")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle<LiveSessionProfileRow>();

    if (profileError) {
      throw profileError;
    }

    if (!profile || profile.verified_badge !== true) {
      return NextResponse.json({ error: "Only verified users can go live." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as StartLiveBody;
    const existingSettings = (profile.theme_settings || {}) as Record<string, unknown>;
    const youtubeUrl = normalizeLiveYoutubeUrl(body.youtubeUrl ?? null);
    const startedAt = new Date().toISOString();
    const nextThemeSettings = {
      ...existingSettings,
      live_status: "live",
      live_title: normalizeLiveTitle(body.title),
      live_started_at: startedAt,
      live_youtube_url: youtubeUrl,
      live_webrtc_requested: true,
    };

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ theme_settings: nextThemeSettings })
      .eq("id", user.id);

    if (updateError) {
      throw updateError;
    }

    const session: LiveSessionSummary = {
      userId: user.id,
      username: profile.username ?? null,
      displayName: profile.display_name ?? null,
      avatarUrl: profile.avatar_url ?? null,
      title: normalizeLiveTitle(body.title),
      startedAt,
      youtubeUrl,
      youtubeEmbedUrl: buildLiveYoutubeEmbedUrl(youtubeUrl),
      webrtcRequested: true,
    };

    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to start live stream." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,theme_settings")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle<{ id: string; theme_settings: Record<string, unknown> | null }>();

    if (profileError) {
      throw profileError;
    }

    const existingSettings = (profile?.theme_settings || {}) as Record<string, unknown>;
    const nextThemeSettings = {
      ...existingSettings,
      live_status: "offline",
      live_title: null,
      live_started_at: null,
      live_youtube_url: null,
      live_webrtc_requested: false,
    };

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ theme_settings: nextThemeSettings })
      .eq("id", user.id);

    if (updateError) {
      throw updateError;
    }

    clearLiveChatMessages(user.id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to stop live stream." },
      { status: 500 }
    );
  }
}
