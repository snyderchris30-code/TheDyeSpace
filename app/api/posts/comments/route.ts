import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createAdminClient, loadProfileStatus, isMuted, userIsAdmin } from "@/lib/admin-utils";
import { applyRateLimit, getClientIp, hasSuspiciousInput, sanitizeUserText } from "@/lib/security/request-guards";
import {
  getStoredCommentReactions,
  getStoredPostComments,
  getStoredPostReactions,
  isMissingInteractionTablesError,
  type StoredPostComment,
  normalizeThemeSettings,
} from "@/lib/post-interactions";
import { loadLegacyInteraction, loadRelationalInteraction } from "@/lib/post-interaction-loaders";
import { sendPushNotificationsForSources } from "@/lib/push-notifications";
import { resolveShopListingContext } from "@/lib/shop-listings";

type CommentBody = {
  postId?: string;
  content?: string;
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

async function createCommentNotification(
  adminClient: ReturnType<typeof createAdminClient>,
  ownerId: string | null | undefined,
  actorId: string,
  actorName: string,
  postId: string,
  commentId: string,
  requireRelationalVerification = true
) {
  const emptySources: Array<{ user_id: string; actor_name: string; type: string; message: string; post_id: string | null }> = [];

  if (!ownerId || ownerId === actorId) {
    return emptySources;
  }

  if (requireRelationalVerification) {
    const baseQuery = adminClient
      .from("post_comments")
      .select("id, post_id")
      .eq("id", commentId)
      .eq("post_id", postId);

    const withDeleteCheck = await baseQuery.is("deleted_at", null).maybeSingle();
    let persistedComment = withDeleteCheck.data;
    let persistedCommentError = withDeleteCheck.error;

    const missingDeletedAt = String(withDeleteCheck.error?.message || "").includes(
      "Could not find the 'deleted_at' column"
    );

    if (missingDeletedAt) {
      const withoutDeleteCheck = await adminClient
        .from("post_comments")
        .select("id, post_id")
        .eq("id", commentId)
        .eq("post_id", postId)
        .maybeSingle();
      persistedComment = withoutDeleteCheck.data;
      persistedCommentError = withoutDeleteCheck.error;
    }

    if (persistedCommentError || !persistedComment) {
      console.error("[notifications] Skipping comment notification because comment could not be verified", {
        ownerId,
        actorId,
        postId,
        commentId,
        error: persistedCommentError?.message || null,
      });
      return emptySources;
    }
  }

  const payload = {
    user_id: ownerId,
    actor_name: actorName,
    type: "comment",
    post_id: postId,
    message: `${actorName} commented on your post.`,
    read: false,
  };

  try {
    const notificationId = await insertNotificationRecord(adminClient, payload);
    if (!notificationId) {
      return emptySources;
    }

    return [
      {
        user_id: ownerId,
        actor_name: actorName,
        type: "comment",
        message: `${actorName} commented on your post.`,
        post_id: postId,
      },
    ];
  } catch (error: any) {
    console.error("[notifications] Failed to create comment notification", {
      ownerId,
      actorId,
      postId,
      commentId,
      error: error?.message || error,
    });
    return emptySources;
  }
}

async function createMentionNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  actorId: string,
  actorName: string,
  postId: string,
  mentionedUsernames: string[],
  commentContent: string,
  actorIsAdmin = false
) {
  const createdSources: Array<{ user_id: string; actor_name: string; type: string; message: string; post_id: string | null }> = [];

  const uniqueUsernames = Array.from(new Set(mentionedUsernames.map((username) => username.toLowerCase())));
  if (!uniqueUsernames.length) {
    return createdSources;
  }

  let mentionQuery = adminClient
    .from("profiles")
    .select("id, username, ghost_ridin")
    .in("username", uniqueUsernames);

  if (!actorIsAdmin) {
    mentionQuery = mentionQuery.eq("ghost_ridin", false);
  }

  const { data: mentionedProfiles, error: mentionProfilesError } = await mentionQuery;

  if (mentionProfilesError) {
    console.error("[notifications] Failed to resolve mentioned usernames", {
      actorId,
      postId,
      error: mentionProfilesError.message,
    });
    return createdSources;
  }

  for (const profile of mentionedProfiles || []) {
    if (profile.id === actorId) {
      continue;
    }

    try {
      const preview = commentContent.replace(/\s+/g, " ").trim().slice(0, 120);
      const replyMessage = `@${actorName} replied: ${preview || "Check the new comment."}`;
      await insertNotificationRecord(adminClient, {
        user_id: profile.id,
        actor_name: actorName,
        type: "mention",
        post_id: postId,
        message: replyMessage,
        read: false,
      });

      createdSources.push({
        user_id: profile.id,
        actor_name: actorName,
        type: "mention",
        message: replyMessage,
        post_id: postId,
      });
    } catch (error: any) {
      console.error("[notifications] Failed to create mention notification", {
        actorId,
        postId,
        mentionedUsername: profile.username,
        error: error?.message || error,
      });
    }
  }

  return createdSources;
}

async function findLegacyCommentOwner(
  adminClient: ReturnType<typeof createAdminClient>,
  commentId: string,
  postId: string,
  viewerId: string,
  viewerIsAdmin: boolean
) {
  let profilesQuery = adminClient.from("profiles").select("id, theme_settings");
  if (!viewerIsAdmin) {
    profilesQuery = profilesQuery.eq("id", viewerId);
  }

  const { data, error } = await profilesQuery;
  if (error) {
    throw error;
  }

  for (const profile of data || []) {
    const rawThemeSettings = profile.theme_settings && typeof profile.theme_settings === "object"
      ? (profile.theme_settings as Record<string, any>)
      : {};
    const normalizedThemeSettings = normalizeThemeSettings(rawThemeSettings as any);
    const comment = getStoredPostComments(normalizedThemeSettings).find(
      (candidate) => candidate.id === commentId && candidate.post_id === postId
    );

    if (comment) {
      return {
        profileId: profile.id,
        rawThemeSettings,
        normalizedThemeSettings,
        comment,
      };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipLimit = applyRateLimit({ key: `api:comments:create:ip:${ip}`, windowMs: 60_000, max: 15, blockMs: 5 * 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as CommentBody;
  const rawContent = typeof body.content === "string" ? body.content : "";

  const userLimit = applyRateLimit({ key: `api:comments:create:user:${user.id}`, windowMs: 60_000, max: 15, blockMs: 5 * 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429 });
  }

  if (hasSuspiciousInput(rawContent)) {
    return NextResponse.json({ error: "Suspicious content was blocked." }, { status: 400 });
  }

  const content = sanitizeUserText(rawContent, 1200);

  if (!body.postId || !content) {
    return NextResponse.json({ error: "Post ID and comment content are required." }, { status: 400 });
  }

  const shopListingContext = resolveShopListingContext(body.postId);

  try {
    const adminClient = createAdminClient();
    const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      return NextResponse.json({ error: "You are muted and cannot post comments at this time." }, { status: 403 });
    }

    const postOwnerId = shopListingContext
      ? shopListingContext.sellerUserId
      : await (async () => {
          const { data: post, error: postError } = await adminClient
            .from("posts")
            .select("id, user_id")
            .eq("id", body.postId)
            .is("deleted_at", null)
            .maybeSingle();

          if (postError || !post) {
            return null;
          }

          return post.user_id;
        })();

    if (!postOwnerId) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    const actorName = resolveProfileUsername(
      actorProfile?.username,
      user.user_metadata?.username,
      user.email,
      user.id
    ).replace(/^@+/, "");

    const mentionMatches = Array.from(content.matchAll(/(?:^|\s)@([a-z0-9._-]{3,30})\b/gi)).map((match) => match[1].toLowerCase());
    const mentionedUsernames = Array.from(new Set(mentionMatches));

    let insertedComment: { id: string; post_id: string; user_id: string } | null = null;
    let insertError: any = { code: "PGRST205", message: "shop listing uses legacy storage" };

    if (!shopListingContext) {
      const relationalInsert = await adminClient
        .from("post_comments")
        .insert({
          post_id: body.postId,
          user_id: user.id,
          content,
        })
        .select("id, post_id, user_id")
        .maybeSingle();

      insertedComment = relationalInsert.data;
      insertError = relationalInsert.error;
    }

    if (!insertError && insertedComment) {
      const interaction = await loadRelationalInteraction(adminClient, body.postId, user.id, viewerIsAdmin);
      const commentsCount = interaction?.comments.length ?? 0;

      const { error: updatePostError } = await adminClient
        .from("posts")
        .update({ comments_count: commentsCount })
        .eq("id", body.postId);

      if (updatePostError) {
        return NextResponse.json({ error: updatePostError.message }, { status: 500 });
      }

      const pushSources = await createCommentNotification(adminClient, postOwnerId, user.id, actorName, body.postId, insertedComment.id);
      if (mentionedUsernames.length) {
        const mentionPushSources = await createMentionNotifications(
          adminClient,
          user.id,
          actorName,
          body.postId,
          mentionedUsernames,
          content,
          viewerIsAdmin
        );
        pushSources.push(...mentionPushSources);
      }

      if (pushSources.length) {
        try {
          await sendPushNotificationsForSources(adminClient, pushSources);
        } catch (pushError) {
          console.error("[push] Failed to send comment/mention push notifications", pushError);
        }
      }

      return NextResponse.json({ interaction, commentsCount, storage: "relational" });
    }

    if (!insertError && !insertedComment) {
      console.error("[comments/create] Insert completed without returning inserted row", {
        postId: body.postId,
        actorId: user.id,
      });
      return NextResponse.json({ error: "Comment insert could not be verified." }, { status: 500 });
    }

    const relationalInsertError = insertError;
    if (!relationalInsertError || !isMissingInteractionTablesError(relationalInsertError)) {
      console.error("[comments/create] Relational comment insert failed", {
        postId: body.postId,
        actorId: user.id,
        error: relationalInsertError?.message || "Unknown insert failure",
        details: relationalInsertError?.details,
        hint: relationalInsertError?.hint,
        code: relationalInsertError?.code,
      });
      return NextResponse.json({ error: relationalInsertError?.message || "Failed to save comment." }, { status: 500 });
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, verified_badge")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const rawThemeSettings = existingProfile?.theme_settings && typeof existingProfile.theme_settings === "object"
      ? (existingProfile.theme_settings as Record<string, any>)
      : {};
    const existingThemeSettings = normalizeThemeSettings(rawThemeSettings as any);
    const nextComments = [
      ...getStoredPostComments(existingThemeSettings),
      {
        id: randomUUID(),
        post_id: body.postId,
        content,
        created_at: new Date().toISOString(),
      },
    ];

    const { error: profileError } = await adminClient.from("profiles").upsert(
      {
        id: user.id,
        username: resolveProfileUsername(existingProfile?.username, user.user_metadata?.username, user.email, user.id),
        display_name: existingProfile?.display_name ?? "",
        bio: existingProfile?.bio ?? "",
        avatar_url: existingProfile?.avatar_url ?? null,
        banner_url: existingProfile?.banner_url ?? null,
        verified_badge: existingProfile?.verified_badge ?? false,
        theme_settings: {
          ...rawThemeSettings,
          post_comments: nextComments,
          post_reactions: getStoredPostReactions(existingThemeSettings),
          comment_reactions: getStoredCommentReactions(existingThemeSettings),
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, body.postId, user.id);
    const commentsCount = interaction?.comments.length ?? 0;

    const { error: updatePostError } = await adminClient
      .from("posts")
      .update({ comments_count: commentsCount })
      .eq("id", body.postId);

    if (updatePostError) {
      return NextResponse.json({ error: updatePostError.message }, { status: 500 });
    }

    const fallbackCommentId = nextComments[nextComments.length - 1]?.id;
    if (fallbackCommentId) {
      const pushSources = await createCommentNotification(adminClient, postOwnerId, user.id, actorName, body.postId, fallbackCommentId, false);
      if (mentionedUsernames.length) {
        const mentionPushSources = await createMentionNotifications(
          adminClient,
          user.id,
          actorName,
          body.postId,
          mentionedUsernames,
          content,
          viewerIsAdmin
        );
        pushSources.push(...mentionPushSources);
      }

      if (pushSources.length) {
        try {
          await sendPushNotificationsForSources(adminClient, pushSources);
        } catch (pushError) {
          console.error("[push] Failed to send legacy comment/mention push notifications", pushError);
        }
      }
    }

    return NextResponse.json({ interaction, commentsCount, storage: "legacy" });
  } catch (error: any) {
    console.error("[comments/create] Unexpected failure", {
      error: error?.message || error,
      postId: body.postId,
    });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save comment." },
      { status: 500 }
    );
  }
}

// PATCH /api/posts/comments — edit a comment
export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { commentId?: string; postId?: string; content?: string };
  const content = body.content?.trim();
  if (!body.commentId || !body.postId || !content) {
    return NextResponse.json({ error: "commentId, postId, and content are required" }, { status: 400 });
  }

  const shopListingContext = resolveShopListingContext(body.postId);

  const adminClient = createAdminClient();
  const viewerIsAdmin = await userIsAdmin(adminClient, user.id);

  if (shopListingContext) {
    const legacyCommentOwner = await findLegacyCommentOwner(adminClient, body.commentId, body.postId, user.id, viewerIsAdmin);
    if (!legacyCommentOwner) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    if (legacyCommentOwner.profileId !== user.id && !viewerIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nextComments = getStoredPostComments(legacyCommentOwner.normalizedThemeSettings).map((comment) =>
      comment.id === body.commentId ? { ...comment, content } : comment
    );

    const { error: updateThemeError } = await adminClient
      .from("profiles")
      .update({
        theme_settings: {
          ...legacyCommentOwner.rawThemeSettings,
          post_comments: nextComments,
        },
      })
      .eq("id", legacyCommentOwner.profileId);

    if (updateThemeError) {
      return NextResponse.json({ error: updateThemeError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, body.postId, user.id);
    return NextResponse.json({ interaction, commentsCount: interaction?.comments.length ?? 0 });
  }

  const { data: comment, error: fetchError } = await adminClient
    .from("post_comments")
    .select("id, user_id")
    .eq("id", body.commentId)
    .maybeSingle();

  if (fetchError || !comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (comment.user_id !== user.id) {
    const admin = await userIsAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error: updateError } = await adminClient
    .from("post_comments")
    .update({ content })
    .eq("id", body.commentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const interaction = await loadRelationalInteraction(adminClient, body.postId, user.id, viewerIsAdmin);
  return NextResponse.json({ interaction, commentsCount: interaction?.comments.length ?? 0 });
}

// DELETE /api/posts/comments?commentId=...&postId=... — delete a comment
export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const commentId = searchParams.get("commentId");
  const postId = searchParams.get("postId");
  if (!commentId || !postId) {
    return NextResponse.json({ error: "commentId and postId are required" }, { status: 400 });
  }

  const shopListingContext = resolveShopListingContext(postId);

  const adminClient = createAdminClient();
  const viewerIsAdmin = await userIsAdmin(adminClient, user.id);

  if (shopListingContext) {
    const legacyCommentOwner = await findLegacyCommentOwner(adminClient, commentId, postId, user.id, viewerIsAdmin);
    if (!legacyCommentOwner) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    if (legacyCommentOwner.profileId !== user.id && !viewerIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const nextComments = getStoredPostComments(legacyCommentOwner.normalizedThemeSettings).filter((comment) => comment.id !== commentId);
    const { error: updateThemeError } = await adminClient
      .from("profiles")
      .update({
        theme_settings: {
          ...legacyCommentOwner.rawThemeSettings,
          post_comments: nextComments,
        },
      })
      .eq("id", legacyCommentOwner.profileId);

    if (updateThemeError) {
      return NextResponse.json({ error: updateThemeError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, postId, user.id);
    return NextResponse.json({ interaction, commentsCount: interaction?.comments.length ?? 0 });
  }

  const { data: comment, error: fetchError } = await adminClient
    .from("post_comments")
    .select("id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (comment.user_id !== user.id) {
    const admin = await userIsAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const mode = searchParams.get("mode") || "soft";

  if (mode === "permanent") {
    const admin = await userIsAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: deleteError } = await adminClient.from("post_comments").delete().eq("id", commentId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
  } else if (mode === "restore") {
    const admin = await userIsAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: restoreError } = await adminClient
      .from("post_comments")
      .update({ deleted_at: null })
      .eq("id", commentId);

    if (restoreError) {
      return NextResponse.json({ error: restoreError.message }, { status: 500 });
    }
  } else {
    const { error: softDeleteError } = await adminClient
      .from("post_comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", commentId);

    if (softDeleteError) {
      return NextResponse.json({ error: softDeleteError.message }, { status: 500 });
    }
  }

  const interaction = await loadRelationalInteraction(adminClient, postId, user.id, viewerIsAdmin);
  const commentsCount = interaction?.comments.length ?? 0;
  await adminClient.from("posts").update({ comments_count: commentsCount }).eq("id", postId);

  return NextResponse.json({ interaction, commentsCount });
}