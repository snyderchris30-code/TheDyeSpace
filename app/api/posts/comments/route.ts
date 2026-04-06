import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createAdminClient, loadProfileStatus, isMuted, userIsAdmin } from "@/lib/admin-utils";
import {
  buildInteractionsByPost,
  buildInteractionsFromRows,
  getStoredPostComments,
  getStoredPostReactions,
  isMissingInteractionTablesError,
  normalizeThemeSettings,
  type InteractionProfileRow,
  type RelationalPostCommentRow,
  type RelationalPostReactionRow,
} from "@/lib/post-interactions";

function isShadowBanned(profile?: { shadow_banned?: boolean | null; shadow_banned_until?: string | null }) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

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
  if (!ownerId || ownerId === actorId) {
    console.info("[notifications] Skipping comment notification", {
      reason: !ownerId ? "missing_owner" : "self_action",
      ownerId,
      actorId,
      postId,
    });
    return;
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
      return;
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

  console.info("[notifications] Attempting comment notification", {
    ownerId,
    actorId,
    postId,
    commentId,
    actorName,
  });

  try {
    const notificationId = await insertNotificationRecord(adminClient, payload);
    console.info("[notifications] Comment notification created", {
      notificationId,
      ownerId,
      actorId,
      postId,
      commentId,
    });
  } catch (error: any) {
    console.error("[notifications] Failed to create comment notification", {
      ownerId,
      actorId,
      postId,
      commentId,
      error: error?.message || error,
    });
  }
}

async function loadLegacyInteraction(adminClient: ReturnType<typeof createAdminClient>, postId: string, viewerId?: string | null) {
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, avatar_url, verified_badge, member_number, theme_settings");

  if (error) {
    throw error;
  }

  return buildInteractionsByPost((profiles || []) as InteractionProfileRow[], [postId], viewerId)[postId];
}

async function loadRelationalInteraction(adminClient: ReturnType<typeof createAdminClient>, postId: string, viewerId?: string | null, viewerIsAdmin = false) {
  let commentsResponse = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .eq("post_id", postId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const missingDeletedAt = String(commentsResponse.error?.message || "").includes("Could not find the 'deleted_at' column");
  if (missingDeletedAt) {
    commentsResponse = await adminClient
      .from("post_comments")
      .select("id, post_id, user_id, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
  }

  const comments = commentsResponse.data;
  const commentsError = commentsResponse.error;

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
    const primaryProfileResponse = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url, verified_badge, member_number, shadow_banned, shadow_banned_until")
      .in("id", userIds);

    const missingShadowColumns = String(primaryProfileResponse.error?.message || "").includes("Could not find the")
      && (String(primaryProfileResponse.error?.message || "").includes("shadow_banned")
        || String(primaryProfileResponse.error?.message || "").includes("shadow_banned_until"));

    let profileRows = primaryProfileResponse.data;
    let profilesError = primaryProfileResponse.error;

    if (missingShadowColumns) {
      const fallbackProfileResponse = await adminClient
        .from("profiles")
        .select("id, username, display_name, avatar_url, verified_badge, member_number")
        .in("id", userIds);
      profileRows = fallbackProfileResponse.data as typeof profileRows;
      profilesError = fallbackProfileResponse.error;
    }

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

  const body = (await req.json().catch(() => ({}))) as CommentBody;
  const content = body.content?.trim();

  if (!body.postId || !content) {
    return NextResponse.json({ error: "Post ID and comment content are required." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      return NextResponse.json({ error: "You are muted and cannot post comments at this time." }, { status: 403 });
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

    console.info("[comments/create] Attempting comment insert", {
      postId: body.postId,
      actorId: user.id,
      contentLength: content.length,
    });

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("username, display_name")
      .eq("id", user.id)
      .maybeSingle();

    const actorName = actorProfile?.display_name?.trim() || resolveProfileUsername(actorProfile?.username, user.user_metadata?.username, user.email, user.id);

    const { data: insertedComment, error: insertError } = await adminClient
      .from("post_comments")
      .insert({
        post_id: body.postId,
        user_id: user.id,
        content,
      })
      .select("id, post_id, user_id")
      .maybeSingle();

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

      await createCommentNotification(adminClient, post.user_id, user.id, actorName, body.postId, insertedComment.id);

      console.info("[comments/create] Comment insert succeeded", {
        postId: body.postId,
        actorId: user.id,
        commentId: insertedComment.id,
        commentsCount,
      });

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
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const existingThemeSettings = normalizeThemeSettings(existingProfile?.theme_settings);
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
        theme_settings: {
          ...existingThemeSettings,
          post_comments: nextComments,
          post_reactions: getStoredPostReactions(existingThemeSettings),
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
      await createCommentNotification(adminClient, post.user_id, user.id, actorName, body.postId, fallbackCommentId, false);
    }

    console.info("[comments/create] Legacy comment save succeeded", {
      postId: body.postId,
      actorId: user.id,
      commentId: fallbackCommentId,
      commentsCount,
    });

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

  const adminClient = createAdminClient();
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

  const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
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

  const adminClient = createAdminClient();
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

  const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
  const interaction = await loadRelationalInteraction(adminClient, postId, user.id, viewerIsAdmin);
  const commentsCount = interaction?.comments.length ?? 0;
  await adminClient.from("posts").update({ comments_count: commentsCount }).eq("id", postId);

  return NextResponse.json({ interaction, commentsCount });
}