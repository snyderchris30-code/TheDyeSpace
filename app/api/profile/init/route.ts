import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
} from "@/lib/profile-theme";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";

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

export async function POST(req: Request) {
  const requestContext = createRequestLogContext(req, "profile/init");

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("profile/init", "Unauthorized profile init request", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceUrl || !serviceKey) {
      logError("profile/init", "Missing service role configuration", new Error("Service role key missing"), {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Server misconfiguration: service role key missing" },
        { status: 500 }
      );
    }

    const adminClient = createServiceClient(serviceUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const username = resolveProfileUsername(user.user_metadata?.username, user.email, user.id);

    logInfo("profile/init", "Initializing profile", {
      ...requestContext,
      userId: user.id,
      resolvedUsername: username,
    });

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingProfileError) {
      logError("profile/init", "Failed to query existing profile", existingProfileError, {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json({ error: existingProfileError.message }, { status: 500 });
    }

    const { data: profile, error: upsertError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username,
          display_name: "",
          bio: "",
          avatar_url: null,
          banner_url: null,
          role: null,
          muted_until: null,
          voided_until: null,
          verified_badge: false,
          shadow_banned: false,
          shadow_banned_until: null,
          smoke_room_2_invited: false,
          theme_settings: {
            background_color: DEFAULT_BACKGROUND_COLOR,
            text_color: DEFAULT_TEXT_COLOR,
            highlight_color: DEFAULT_HIGHLIGHT_COLOR,
            font_style: DEFAULT_FONT_STYLE,
            youtube_urls: [],
            show_music_player: true,
          },
        },
        { onConflict: "id", ignoreDuplicates: false }
      )
      .select(
        "id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at, role, muted_until, voided_until, verified_badge, member_number, shadow_banned, shadow_banned_until, smoke_room_2_invited"
      )
      .limit(1)
      .maybeSingle();

    if (upsertError) {
      logError("profile/init", "Failed to upsert profile", upsertError, {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    if (!existingProfile) {
      try {
        await ensureAdminAutoFollow(adminClient, user.id);
      } catch (error: any) {
        logWarn("profile/init", "Admin auto-follow skipped", {
          ...requestContext,
          userId: user.id,
          error: error?.message || error,
        });
      }
    }

    logInfo("profile/init", "Profile initialized", {
      ...requestContext,
      userId: user.id,
      createdProfile: !existingProfile,
    });

    return NextResponse.json({ profile });
  } catch (error: any) {
    logError("profile/init", "Unexpected profile init failure", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to initialize profile." },
      { status: 500 }
    );
  }
}
