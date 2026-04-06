import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, loadProfileStatus, isMuted, userIsAdmin } from "@/lib/admin-utils";
import {
  REACTION_EMOJIS,
  buildInteractionsFromRows,
  countInteractionReactions,
  getStoredPostComments,
  getStoredPostReactions,
  isMissingInteractionTablesError,
  normalizeThemeSettings,
  type InteractionProfileRow,
  type RelationalPostCommentRow,
  type RelationalPostReactionRow,
  type ReactionEmoji,
} from "@/lib/post-interactions";

import { resolveProfileUsername } from "@/lib/profile-identity";

function isShadowBanned(profile?: { shadow_banned?: boolean | null; shadow_banned_until?: string | null }) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

type ReactionBody = {
  postId?: string;
  emoji?: ReactionEmoji;
};

async function insertNotificationRecord(
  adminClient: ReturnType<typeof createAdminClient>,
  payload: Record<string, any>
) {
  const { data, error } = await adminClient
    .from("notifications")
    .insert(payload)
    .select("id")
    .limit(1);

  if (!error) {
    return data?.[0]?.id ?? null;
  }

  const cacheError = String(error.message || "").includes("Could not find the 'post_id' column of 'notifications' in the schema cache");
  if (cacheError && payload.post_id !== undefined) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.post_id;
    const { data: fallbackData, error: fallbackError } = await adminClient
      .from("notifications")
      .insert(fallbackPayload)
      .select("id")
      .limit(1);

    if (!fallbackError) {
      return fallbackData?.[0]?.id ?? null;
    }
  }

  throw error;
}

async function createLikeNotification(
  adminClient: ReturnType<typeof createAdminClient>,
  ownerId: string | null | undefined,
  actorId: string,
  actorName: string,
  postId: string,
  emoji: ReactionEmoji
) {
  if (!ownerId || ownerId === actorId) {
    return;
  }

  const payload = {
    user_id: ownerId,
    actor_name: actorName,
    type: "like",
    post_id: postId,
    message: `${actorName} reacted ${emoji} to your post.`,
    read: false,
  };

  try {
    const notificationId = await insertNotificationRecord(adminClient, payload);
    console.info("[notifications] Like notification created", {
      notificationId,
      ownerId,
      actorId,
      postId,
      emoji,
    });
  } catch (error: any) {
    console.error("[notifications] Failed to create like notification", {
      ownerId,
      actorId,
      postId,
      emoji,
      error: error?.message || error,
    });
  }
}

async function loadLegacyInteraction(adminClient: ReturnType<typeof createAdminClient>, postId: string, viewerId?: string | null) {
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, avatar_url, theme_settings");

  if (error) {
    throw error;
  }

  // There is no buildInteractionsByPost, use buildInteractionsFromRows with empty comments/reactions
  const interactions = buildInteractionsFromRows(
    [postId],
    [], // no comments
    [], // no reactions
    (profiles || []) as InteractionProfileRow[],
    viewerId
  );
  return interactions[postId];
}


async function loadRelationalInteraction(adminClient: ReturnType<typeof createAdminClient>, postId: string, viewerId?: string | null, viewerIsAdmin = false) {
  const { data: comments, error: commentsError } = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .eq("post_id", postId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (commentsError) {
    throw commentsError;
  }

  const { data: reactions, error: reactionsError } = await adminClient
    .from("post_reactions")
    .select("post_id, user_id, emoji, created_at")
    .eq("post_id", postId);

  if (reactionsError) {
    throw reactionsError;
  }

  const userIds = [...new Set([...(comments || []).map((comment) => comment.user_id), ...(reactions || []).map((reaction) => reaction.user_id)])];
  let profiles: Array<InteractionProfileRow & { shadow_banned?: boolean | null; shadow_banned_until?: string | null }> = [];

  if (userIds.length) {
    const { data: profileRows, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url, shadow_banned, shadow_banned_until")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    profiles = (profileRows || []) as InteractionProfileRow[];
  }

  const shadowBannedAuthors = new Set(profiles.filter((profile) => isShadowBanned(profile)).map((profile) => profile.id));
  const visibleComments = viewerIsAdmin
    ? (comments || [])
    : (comments || []).filter((comment) => comment.user_id === viewerId || !shadowBannedAuthors.has(comment.user_id));
  const visibleReactions = viewerIsAdmin
    ? (reactions || [])
    : (reactions || []).filter((reaction) => reaction.user_id === viewerId || !shadowBannedAuthors.has(reaction.user_id));

  return buildInteractionsFromRows(
    [postId],
    visibleComments as RelationalPostCommentRow[],
    visibleReactions as RelationalPostReactionRow[],
    profiles,
    viewerId
  )[postId];
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

  const body = (await req.json().catch(() => ({}))) as ReactionBody;

  if (!body.postId || !body.emoji || !REACTION_EMOJIS.includes(body.emoji)) {
    return NextResponse.json({ error: "Post ID and valid emoji are required." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      return NextResponse.json({ error: "You are muted and cannot react at this time." }, { status: 403 });
    }

    const { data: post, error: postError } = await adminClient
      .from("posts")
      .select("id, user_id")
      .eq("id", body.postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("username, display_name")
      .eq("id", user.id)
      .maybeSingle();

    const actorName = actorProfile?.display_name?.trim() || resolveProfileUsername(actorProfile?.username, user.user_metadata?.username, user.email, user.id);

    const { data: currentReaction, error: currentReactionError } = await adminClient
      .from("post_reactions")
      .select("emoji")
      .eq("post_id", body.postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!currentReactionError) {
      let shouldNotify = false;

      if (currentReaction?.emoji === body.emoji) {
        const { error: deleteError } = await adminClient
          .from("post_reactions")
          .delete()
          .eq("post_id", body.postId)
          .eq("user_id", user.id);

        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }
      } else if (currentReaction) {
        const { error: updateError } = await adminClient
          .from("post_reactions")
          .update({ emoji: body.emoji, created_at: new Date().toISOString() })
          .eq("post_id", body.postId)
          .eq("user_id", user.id);

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
        shouldNotify = true;
      } else {
        const { error: insertError } = await adminClient.from("post_reactions").insert({
          post_id: body.postId,
          user_id: user.id,
          emoji: body.emoji,
        });

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
        shouldNotify = true;
      }

      const interaction = await loadRelationalInteraction(adminClient, body.postId, user.id, viewerIsAdmin);
      const likesCount = countInteractionReactions(interaction);

      const { error: updatePostError } = await adminClient
        .from("posts")
        .update({ likes: likesCount })
        .eq("id", body.postId);

      if (updatePostError) {
        return NextResponse.json({ error: updatePostError.message }, { status: 500 });
      }

      if (shouldNotify) {
        await createLikeNotification(adminClient, post.user_id, user.id, actorName, body.postId, body.emoji);
      }

      return NextResponse.json({ interaction, likesCount, storage: "relational" });
    }

    if (!isMissingInteractionTablesError(currentReactionError)) {
      return NextResponse.json({ error: currentReactionError.message }, { status: 500 });
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const existingThemeSettings = normalizeThemeSettings(existingProfile?.theme_settings);
    const existingReactions = getStoredPostReactions(existingThemeSettings);
    const legacyCurrentReaction = existingReactions.find((reaction) => reaction.post_id === body.postId);
    const nextReactions = existingReactions.filter((reaction) => reaction.post_id !== body.postId);
    const shouldNotify = !legacyCurrentReaction || legacyCurrentReaction.emoji !== body.emoji;

    if (!legacyCurrentReaction || legacyCurrentReaction.emoji !== body.emoji) {
      nextReactions.push({
        post_id: body.postId,
        emoji: body.emoji,
        created_at: new Date().toISOString(),
      });
    }

    const { error: profileError } = await adminClient.from("profiles").upsert(
      {
        id: user.id,
        username: resolveProfileUsername(existingProfile?.username, user.user_metadata?.username, user.email, user.id),
        display_name: existingProfile?.display_name ?? "",
        bio: existingProfile?.bio ?? "",
        avatar_url: existingProfile?.avatar_url ?? null,
        banner_url: existingProfile?.banner_url ?? null,
        theme_settings: {
          ...existingThemeSettings,
          post_comments: getStoredPostComments(existingThemeSettings),
          post_reactions: nextReactions,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, body.postId, user.id);
    const likesCount = countInteractionReactions(interaction);

    const { error: updatePostError } = await adminClient
      .from("posts")
      .update({ likes: likesCount })
      .eq("id", body.postId);

    if (updatePostError) {
      return NextResponse.json({ error: updatePostError.message }, { status: 500 });
    }

    if (shouldNotify) {
      await createLikeNotification(adminClient, post.user_id, user.id, actorName, body.postId, body.emoji);
    }

    return NextResponse.json({ interaction, likesCount, storage: "legacy" });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save reaction." },
      { status: 500 }
    );
  }
}