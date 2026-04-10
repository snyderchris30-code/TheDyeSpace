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
  type ProfileAppearance,
} from "@/lib/profile-theme";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";
import { normalizeSellerProducts, resolveSellerContactSettings } from "@/lib/verified-seller";
import type { SellerProduct } from "@/types/database";
import { normalizeMusicPlayerUrls, normalizeYoutubeVideoUrls } from "@/lib/youtube-media";

const ADMIN_AUTO_FOLLOW_USER_ID = "794077c7-ad51-47cc-8c25-20171edfb017";

function isMissingUserFollowsTable(error: any) {
  return error?.code === "42P01" || /user_follows/i.test(String(error?.message || ""));
}

async function ensureAdminAutoFollow(adminClient: any, targetUserId: string) {
  if (!targetUserId || targetUserId === ADMIN_AUTO_FOLLOW_USER_ID) {
    return;
  }

  const { error: followError } = await adminClient.from("user_follows").upsert({
    follower_id: ADMIN_AUTO_FOLLOW_USER_ID,
    followed_id: targetUserId,
  });

  if (followError && !isMissingUserFollowsTable(followError)) {
    throw followError;
  }

  const { error: notificationError } = await adminClient.from("notifications").insert({
    user_id: targetUserId,
    actor_name: "TheDyeSpace",
    type: "follow",
    post_id: null,
    message: "TheDyeSpace started following you.",
    read: false,
  });

  if (notificationError) {
    const cacheError = String(notificationError.message || "").includes(
      "Could not find the 'post_id' column of 'notifications' in the schema cache"
    );

    if (cacheError) {
      await adminClient.from("notifications").insert({
        user_id: targetUserId,
        actor_name: "TheDyeSpace",
        type: "follow",
        message: "TheDyeSpace started following you.",
        read: false,
      });
    }
  }
}

type SaveBody = {
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
  banner_url?: string | null;
  background_color?: string;
  background_opacity?: number;
  text_color?: string;
  highlight_color?: string;
  font_style?: FontStyle;
  youtube_urls?: string[];
  music_player_urls?: string[];
  show_music_player?: boolean;
  seller_background_url?: string | null;
  seller_contact_email?: string | null;
  seller_contact_phone?: string | null;
  seller_contact_link?: string | null;
  seller_contact_message?: string | null;
  shop_products?: SellerProduct[];
};

export async function POST(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "profile/save");

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("profile/save", "Unauthorized profile save request", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceUrl || !serviceKey) {
      logError("profile/save", "Missing service role configuration", new Error("Service role key missing"), {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Server misconfiguration: service role key missing" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as SaveBody;

    const adminClient = createServiceClient(serviceUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("profiles")
      .select("username, display_name, bio, avatar_url, banner_url, theme_settings, verified_badge")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingProfileError) {
      logError("profile/save", "Failed to load existing profile before save", existingProfileError, {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json({ error: existingProfileError.message }, { status: 500 });
    }

    const existingThemeSettings = (existingProfile?.theme_settings ?? {}) as ProfileAppearance;
    const existingSellerSettings = resolveSellerContactSettings(existingThemeSettings);

    const safeUsername = resolveProfileUsername(
      body.username,
      existingProfile?.username,
      typeof user.user_metadata?.username === "string" ? user.user_metadata.username : null,
      user.email,
      user.id
    );

    if (safeUsername !== existingProfile?.username) {
      const { data: usernameConflict, error: usernameConflictError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("username", safeUsername)
        .neq("id", user.id)
        .limit(1)
        .maybeSingle();

      if (usernameConflictError) {
        logError("profile/save", "Failed to validate username uniqueness", usernameConflictError, {
          ...requestContext,
          userId: user.id,
          requestedUsername: safeUsername,
        });
        return NextResponse.json({ error: usernameConflictError.message }, { status: 500 });
      }

      if (usernameConflict) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
    }

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
    const nextShopProducts = body.shop_products
      ? normalizeSellerProducts(body.shop_products)
      : Array.isArray(existingThemeSettings.shop_products)
        ? normalizeSellerProducts(existingThemeSettings.shop_products)
        : [];
    const nextFontStyle = body.font_style
      ? normalizeFontStyle(body.font_style)
      : existingThemeSettings.font_style
        ? normalizeFontStyle(existingThemeSettings.font_style)
        : DEFAULT_FONT_STYLE;
    const nextSellerSettings = existingProfile?.verified_badge === true
      ? resolveSellerContactSettings({
          seller_background_url:
            body.seller_background_url !== undefined
              ? body.seller_background_url
              : existingSellerSettings.seller_background_url,
          seller_contact_email:
            body.seller_contact_email !== undefined
              ? body.seller_contact_email
              : existingSellerSettings.seller_contact_email,
          seller_contact_phone:
            body.seller_contact_phone !== undefined
              ? body.seller_contact_phone
              : existingSellerSettings.seller_contact_phone,
          seller_contact_link:
            body.seller_contact_link !== undefined
              ? body.seller_contact_link
              : existingSellerSettings.seller_contact_link,
          seller_contact_message:
            body.seller_contact_message !== undefined
              ? body.seller_contact_message
              : existingSellerSettings.seller_contact_message,
        })
      : existingSellerSettings;

    logInfo("profile/save", "Saving profile", {
      ...requestContext,
      userId: user.id,
      hasAvatar: body.avatar_url !== undefined,
      hasBanner: body.banner_url !== undefined,
      bioLength: typeof body.bio === "string" ? body.bio.length : null,
      youtubeUrlCount: nextYoutubeUrls.length,
      musicPlayerUrlCount: nextMusicPlayerUrls.length,
      shopProductCount: nextShopProducts.length,
      fontStyle: nextFontStyle,
      verifiedSeller: existingProfile?.verified_badge === true,
    });

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
            background_opacity:
              typeof body.background_opacity === "number"
                ? Math.max(0, Math.min(1, body.background_opacity))
                : typeof existingThemeSettings.background_opacity === "number"
                  ? Math.max(0, Math.min(1, existingThemeSettings.background_opacity))
                  : 0.7,
            text_color: body.text_color ?? existingThemeSettings.text_color ?? DEFAULT_TEXT_COLOR,
            highlight_color: body.highlight_color ?? existingThemeSettings.highlight_color ?? DEFAULT_HIGHLIGHT_COLOR,
            font_style: nextFontStyle,
            youtube_urls: nextYoutubeUrls,
            music_player_urls: nextMusicPlayerUrls,
            show_music_player: body.show_music_player ?? existingThemeSettings.show_music_player ?? true,
            seller_background_url: nextSellerSettings.seller_background_url,
            seller_contact_email: nextSellerSettings.seller_contact_email,
            seller_contact_phone: nextSellerSettings.seller_contact_phone,
            seller_contact_link: nextSellerSettings.seller_contact_link,
            seller_contact_message: nextSellerSettings.seller_contact_message,
            shop_products: nextShopProducts,
          },
        },
        { onConflict: "id", ignoreDuplicates: false }
      )
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, verified_badge, member_number, created_at")
      .limit(1)
      .maybeSingle();

    if (upsertError) {
      logError("profile/save", "Failed to save profile", upsertError, {
        ...requestContext,
        userId: user.id,
        resolvedUsername: safeUsername,
      });
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    if (!existingProfile) {
      try {
        await ensureAdminAutoFollow(adminClient, user.id);
      } catch (error: any) {
        logWarn("profile/save", "Admin auto-follow skipped", {
          ...requestContext,
          userId: user.id,
          error: error?.message || error,
        });
      }
    }

    logInfo("profile/save", "Profile saved", {
      ...requestContext,
      userId: user.id,
      resolvedUsername: safeUsername,
    });

    return NextResponse.json({ profile });
  } catch (error: any) {
    logError("profile/save", "Unexpected profile save failure", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save profile." },
      { status: 500 }
    );
  }
}
