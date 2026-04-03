import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  normalizeFontStyle,
  type FontStyle,
} from "@/lib/profile-theme";

type SaveBody = {
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
  banner_url?: string | null;
  background_color?: string;
  text_color?: string;
  highlight_color?: string;
  font_style?: FontStyle;
  youtube_urls?: string[];
};

const YOUTUBE_URL_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function normalizeYoutubeUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const uniqueUrls = new Set<string>();

  for (const rawValue of input) {
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;

    const match = trimmed.match(YOUTUBE_URL_REGEX);
    if (!match) continue;

    const videoId = match[1];
    uniqueUrls.add(`https://www.youtube.com/watch?v=${videoId}`);

    if (uniqueUrls.size >= 25) {
      break;
    }
  }

  return Array.from(uniqueUrls);
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: service role key missing" },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as SaveBody;

  const adminClient = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("username, display_name, bio, avatar_url, banner_url, theme_settings")
    .eq("id", user.id)
    .limit(1)
    .maybeSingle();

  const existingThemeSettings = (existingProfile?.theme_settings ?? {}) as {
    background_color?: string | null;
    text_color?: string | null;
    highlight_color?: string | null;
    font_style?: FontStyle | null;
    youtube_urls?: string[] | null;
  };

  const requestedUsername = typeof body.username === "string" ? body.username.trim() : "";
  const existingUsername = typeof existingProfile?.username === "string" ? existingProfile.username.trim() : "";
  const metadataUsername = typeof user.user_metadata?.username === "string" ? user.user_metadata.username.trim() : "";
  const safeUsername = requestedUsername || existingUsername || metadataUsername || user.email || user.id;

  const nextYoutubeUrls = body.youtube_urls
    ? normalizeYoutubeUrls(body.youtube_urls)
    : Array.isArray(existingThemeSettings.youtube_urls)
      ? normalizeYoutubeUrls(existingThemeSettings.youtube_urls)
      : [];
  const nextFontStyle = body.font_style
    ? normalizeFontStyle(body.font_style)
    : existingThemeSettings.font_style
      ? normalizeFontStyle(existingThemeSettings.font_style)
      : DEFAULT_FONT_STYLE;

  const { data: profile, error: upsertError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        username: safeUsername,
        display_name: body.display_name ?? existingProfile?.display_name ?? "",
        bio: body.bio ?? existingProfile?.bio ?? "",
        avatar_url: body.avatar_url !== undefined ? body.avatar_url : (existingProfile?.avatar_url ?? null),
        banner_url: body.banner_url !== undefined ? body.banner_url : (existingProfile?.banner_url ?? null),
        theme_settings: {
          ...existingThemeSettings,
          background_color: body.background_color ?? existingThemeSettings.background_color ?? DEFAULT_BACKGROUND_COLOR,
          text_color: body.text_color ?? existingThemeSettings.text_color ?? DEFAULT_TEXT_COLOR,
          highlight_color: body.highlight_color ?? existingThemeSettings.highlight_color ?? DEFAULT_HIGHLIGHT_COLOR,
          font_style: nextFontStyle,
          youtube_urls: nextYoutubeUrls,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at")
    .limit(1)
    .maybeSingle();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
