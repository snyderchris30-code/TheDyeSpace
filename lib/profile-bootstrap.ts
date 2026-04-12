import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  type ProfileAppearance,
} from "@/lib/profile-theme";
import { resolveProfileUsername, sanitizeUsernameInput } from "@/lib/profile-identity";

const ADMIN_AUTO_FOLLOW_USER_ID = "794077c7-ad51-47cc-8c25-20171edfb017";

export const PROFILE_LOOKUP_SELECT = [
  "id",
  "username",
  "display_name",
  "bio",
  "avatar_url",
  "banner_url",
  "theme_settings",
  "created_at",
  "role",
  "muted_until",
  "voided_until",
  "verified_badge",
  "member_number",
  "shadow_banned",
  "shadow_banned_until",
  "ghost_ridin",
].join(", ");

const PROFILE_INIT_SELECT = `${PROFILE_LOOKUP_SELECT}, smoke_room_2_invited, psychonautics_access, admin_room_access`;
const PROFILE_BASE_SELECT = [
  "id",
  "username",
  "display_name",
  "bio",
  "avatar_url",
  "banner_url",
  "theme_settings",
  "created_at",
].join(", ");

function isMissingColumnError(error: unknown) {
  const maybeError = error as { code?: string; message?: string };
  if (maybeError?.code === "42703") {
    return true;
  }
  const message = String(maybeError?.message || "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

type ProfileBootstrapUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type EnsureProfileOptions = {
  username?: string | null;
  displayName?: string | null;
};

function firstNonEmptyString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

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

  if (!notificationError) {
    return;
  }

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
    return;
  }

  throw notificationError;
}

export function isOwnProfileRouteUsername(routeUsername: string, user: ProfileBootstrapUser | null | undefined) {
  if (!user) {
    return false;
  }

  const normalizedRouteUsername = sanitizeUsernameInput(routeUsername);
  if (!normalizedRouteUsername) {
    return false;
  }

  const candidateUsername = resolveProfileUsername(
    typeof user.user_metadata?.username === "string" ? user.user_metadata.username : undefined,
    typeof user.email === "string" ? user.email : undefined,
    typeof user.id === "string" ? user.id : undefined
  );

  const identityValues = [
    typeof user.id === "string" ? user.id : null,
    typeof user.user_metadata?.username === "string" ? user.user_metadata.username : null,
    typeof user.email === "string" ? user.email : null,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return Boolean(
    normalizedRouteUsername === candidateUsername ||
      identityValues.some((value) => sanitizeUsernameInput(value) === normalizedRouteUsername)
  );
}

export async function loadProfileByUsername(adminClient: any, username: string) {
  const normalizedUsername = sanitizeUsernameInput(username);

  const { data, error } = await adminClient
    .from("profiles")
    .select(PROFILE_LOOKUP_SELECT)
    .eq("username", normalizedUsername)
    .limit(1)
    .maybeSingle();

  if (error && !isMissingColumnError(error)) {
    throw error;
  }

  if (data && !error) {
    return data;
  }

  if (error && isMissingColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await adminClient
      .from("profiles")
      .select(PROFILE_BASE_SELECT)
      .eq("username", normalizedUsername)
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      throw fallbackError;
    }

    if (fallbackData) {
      return {
        ...fallbackData,
        role: null,
        muted_until: null,
        voided_until: null,
        verified_badge: false,
        member_number: null,
        shadow_banned: false,
        shadow_banned_until: null,
      };
    }
  }

  const { data: fallbackData, error: fallbackError } = await adminClient
    .from("profiles")
    .select(PROFILE_LOOKUP_SELECT)
    .ilike("username", normalizedUsername)
    .limit(1)
    .maybeSingle();

  if (fallbackError && !isMissingColumnError(fallbackError)) {
    throw fallbackError;
  }

  if (fallbackData && !fallbackError) {
    return fallbackData;
  }

  if (fallbackError && isMissingColumnError(fallbackError)) {
    const { data: fallbackMinimalData, error: fallbackMinimalError } = await adminClient
      .from("profiles")
      .select(PROFILE_BASE_SELECT)
      .ilike("username", normalizedUsername)
      .limit(1)
      .maybeSingle();

    if (fallbackMinimalError) {
      throw fallbackMinimalError;
    }

    if (!fallbackMinimalData) {
      return null;
    }

    return {
      ...fallbackMinimalData,
      role: null,
      muted_until: null,
      voided_until: null,
      verified_badge: false,
      member_number: null,
      shadow_banned: false,
      shadow_banned_until: null,
    };
  }

  return fallbackData;
}

export async function ensureProfileForUser(
  adminClient: any,
  user: ProfileBootstrapUser,
  options: EnsureProfileOptions = {}
) {
  const requestedUsername =
    typeof options.username === "string" && options.username.trim()
      ? options.username
      : typeof user.user_metadata?.username === "string"
        ? user.user_metadata.username
        : undefined;
  const initialUsername = resolveProfileUsername(requestedUsername, user.email, user.id);
  let username = initialUsername;
  let usernameAttempt = 1;

  while (true) {
    const { data: usernameConflict, error: usernameConflictError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", user.id)
      .limit(1)
      .maybeSingle();

    if (usernameConflictError) {
      throw usernameConflictError;
    }

    if (!usernameConflict) {
      break;
    }

    username = `${initialUsername}-${user.id.slice(0, 8)}${usernameAttempt > 1 ? usernameAttempt : ""}`;
    usernameAttempt += 1;
    if (usernameAttempt > 5) {
      break;
    }
  }

  const metadataDisplayName = firstNonEmptyString(
    typeof options.displayName === "string" ? options.displayName : null,
    typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
    typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null
  );
  const metadataAvatarUrl = firstNonEmptyString(
    typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
    typeof user.user_metadata?.picture === "string" ? user.user_metadata.picture : null,
    typeof user.user_metadata?.avatar === "string" ? user.user_metadata.avatar : null
  );

  const { data: existingProfile, error: existingProfileError } = await adminClient
    .from("profiles")
    .select(
      "id, username, display_name, bio, avatar_url, banner_url, role, muted_until, voided_until, verified_badge, member_number, shadow_banned, shadow_banned_until, smoke_room_2_invited, psychonautics_access, admin_room_access, ghost_ridin, theme_settings"
    )
    .eq("id", user.id)
    .limit(1)
    .maybeSingle();

  if (existingProfileError && !isMissingColumnError(existingProfileError)) {
    throw existingProfileError;
  }

  const safeExistingProfile = existingProfileError && isMissingColumnError(existingProfileError)
    ? null
    : existingProfile;

  const existingThemeSettings = (safeExistingProfile?.theme_settings ?? {}) as ProfileAppearance;

  const { data: profile, error: upsertError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        username: safeExistingProfile?.username || username,
        display_name: firstNonEmptyString(safeExistingProfile?.display_name, metadataDisplayName, username) ?? username,
        bio: safeExistingProfile?.bio ?? "",
        avatar_url: firstNonEmptyString(safeExistingProfile?.avatar_url, metadataAvatarUrl),
        banner_url: safeExistingProfile?.banner_url ?? null,
        role: safeExistingProfile?.role ?? null,
        muted_until: safeExistingProfile?.muted_until ?? null,
        voided_until: safeExistingProfile?.voided_until ?? null,
        verified_badge: safeExistingProfile?.verified_badge ?? false,
        shadow_banned: safeExistingProfile?.shadow_banned ?? false,
        shadow_banned_until: safeExistingProfile?.shadow_banned_until ?? null,
        ghost_ridin: safeExistingProfile?.ghost_ridin ?? false,
        smoke_room_2_invited:
          safeExistingProfile?.verified_badge === true ? true : safeExistingProfile?.smoke_room_2_invited ?? false,
        psychonautics_access: safeExistingProfile?.psychonautics_access ?? false,
        admin_room_access: safeExistingProfile?.admin_room_access ?? false,
        theme_settings: {
          ...existingThemeSettings,
          background_color: existingThemeSettings.background_color ?? DEFAULT_BACKGROUND_COLOR,
          background_opacity:
            typeof existingThemeSettings.background_opacity === "number"
              ? existingThemeSettings.background_opacity
              : 0.7,
          text_color: existingThemeSettings.text_color ?? DEFAULT_TEXT_COLOR,
          highlight_color: existingThemeSettings.highlight_color ?? DEFAULT_HIGHLIGHT_COLOR,
          font_style: existingThemeSettings.font_style ?? DEFAULT_FONT_STYLE,
          youtube_urls: Array.isArray(existingThemeSettings.youtube_urls) ? existingThemeSettings.youtube_urls : [],
          music_player_urls: Array.isArray(existingThemeSettings.music_player_urls)
            ? existingThemeSettings.music_player_urls
            : [],
          show_music_player: existingThemeSettings.show_music_player ?? true,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select(PROFILE_INIT_SELECT)
    .limit(1)
    .maybeSingle();

  let safeProfile = profile;
  if (upsertError && isMissingColumnError(upsertError)) {
    const { data: fallbackUpsertProfile, error: fallbackUpsertError } = await adminClient
      .from("profiles")
      .select(PROFILE_BASE_SELECT)
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    if (fallbackUpsertError) {
      throw fallbackUpsertError;
    }

    safeProfile = fallbackUpsertProfile
      ? {
          ...fallbackUpsertProfile,
          role: null,
          muted_until: null,
          voided_until: null,
          verified_badge: false,
          member_number: null,
          shadow_banned: false,
          shadow_banned_until: null,
        }
      : fallbackUpsertProfile;
  } else if (upsertError) {
    throw upsertError;
  }

  let autoFollowError: unknown = null;
  if (!safeExistingProfile) {
    try {
      await ensureAdminAutoFollow(adminClient, user.id);
    } catch (error) {
      autoFollowError = error;
    }
  }

  return {
    profile: safeProfile,
    createdProfile: !safeExistingProfile,
    resolvedUsername: username,
    autoFollowError,
  };
}
