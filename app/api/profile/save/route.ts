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
import { resolveProfileUsername } from "@/lib/profile-identity";
import { normalizeMusicPlayerUrls, normalizeYoutubeVideoUrls } from "@/lib/youtube-media";

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
  music_player_urls?: string[];
  show_music_player?: boolean;
};

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
    music_player_urls?: string[] | null;
    show_music_player?: boolean | null;
  };

  const safeUsername = resolveProfileUsername(
    body.username,
    existingProfile?.username,
    typeof user.user_metadata?.username === "string" ? user.user_metadata.username : null,
    user.email,
    user.id
  );

  const nextYoutubeUrls = body.youtube_urls
    ? normalizeYoutubeVideoUrls(body.youtube_urls)
    : Array.isArray(existingThemeSettings.youtube_urls)
      ? normalizeYoutubeVideoUrls(existingThemeSettings.youtube_urls)
      : [];
  const nextMusicPlayerUrls = body.music_player_urls
    ? normalizeMusicPlayerUrls(body.music_player_urls)
    : Array.isArray(existingThemeSettings.music_player_urls)
      ? normalizeMusicPlayerUrls(existingThemeSettings.music_player_urls)
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
          music_player_urls: nextMusicPlayerUrls,
          show_music_player: body.show_music_player ?? existingThemeSettings.show_music_player ?? true,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, verified_badge, member_number, created_at")
    .limit(1)
    .maybeSingle();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
