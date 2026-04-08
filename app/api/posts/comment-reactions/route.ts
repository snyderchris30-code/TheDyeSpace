import { NextRequest, NextResponse } from "next/server";

import { createAdminClient, isMuted, loadProfileStatus, userIsAdmin } from "@/lib/admin-utils";
import { getCustomEmojiFileNameSet } from "@/lib/custom-emoji-registry";
import { loadLegacyInteraction, loadRelationalInteraction } from "@/lib/post-interaction-loaders";
import {
  getStoredCommentReactions,
  getStoredPostComments,
  getStoredPostReactions,
  isMissingInteractionTablesError,
  normalizeThemeSettings,
  type ReactionEmoji,
} from "@/lib/post-interactions";
import { normalizeCustomEmojiUrl } from "@/lib/custom-emojis";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CommentReactionBody = {
  postId?: string;
  commentId?: string;
  emoji?: ReactionEmoji;
};

async function loadTargetComment(adminClient: ReturnType<typeof createAdminClient>, commentId: string, postId: string) {
  let commentResponse = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .eq("post_id", postId)
    .is("deleted_at", null)
    .maybeSingle();

  const missingDeletedAt = String(commentResponse.error?.message || "").includes("Could not find the 'deleted_at' column");
  if (missingDeletedAt) {
    commentResponse = await adminClient
      .from("post_comments")
      .select("id, post_id, user_id")
      .eq("id", commentId)
      .eq("post_id", postId)
      .maybeSingle();
  }

  if (commentResponse.error || !commentResponse.data) {
    return null;
  }

  return commentResponse.data;
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();


  if (authError || !user) {
    // eslint-disable-next-line no-console
    console.error("[posts/comment-reactions] Auth error or missing user", { authError });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as CommentReactionBody;
  const normalizedEmoji = normalizeCustomEmojiUrl(body.emoji);
  const allowedEmojiSet = await getCustomEmojiFileNameSet();

  if (!body.postId || !body.commentId || !normalizedEmoji || !allowedEmojiSet.has(normalizedEmoji)) {
    // eslint-disable-next-line no-console
    console.error("[posts/comment-reactions] Invalid comment reaction emoji", {
      postId: body.postId,
      commentId: body.commentId,
      emoji: body.emoji,
      normalizedEmoji,
      validEmojiCount: allowedEmojiSet.size,
    });
    return NextResponse.json({ error: "Post ID, comment ID, and a valid emoji are required." }, { status: 400 });
  }

  const emoji = normalizedEmoji;

  try {
    const adminClient = createAdminClient();
    const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      // eslint-disable-next-line no-console
      console.error("[posts/comment-reactions] User is muted", { userId: user.id });
      return NextResponse.json({ error: "You are muted and cannot react at this time." }, { status: 403 });
    }

    const { data: post, error: postError } = await adminClient
      .from("posts")
      .select("id")
      .eq("id", body.postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError || !post) {
      // eslint-disable-next-line no-console
      console.error("[posts/comment-reactions] Post not found", { postId: body.postId, postError });
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const comment = await loadTargetComment(adminClient, body.commentId, body.postId);
    if (!comment) {
      // eslint-disable-next-line no-console
      console.error("[posts/comment-reactions] Comment not found", { commentId: body.commentId, postId: body.postId });
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }

    const { data: currentReaction, error: currentReactionError } = await adminClient
      .from("post_comment_reactions")
      .select("emoji")
      .eq("comment_id", body.commentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!currentReactionError) {
      if (currentReaction?.emoji === emoji) {
        const { error: deleteError } = await adminClient
          .from("post_comment_reactions")
          .delete()
          .eq("comment_id", body.commentId)
          .eq("user_id", user.id);

        if (deleteError) {
          // eslint-disable-next-line no-console
          console.error("[posts/comment-reactions] Failed to delete comment reaction", { commentId: body.commentId, userId: user.id, deleteError });
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }
      } else if (currentReaction) {
        const { error: updateError } = await adminClient
          .from("post_comment_reactions")
          .update({ emoji, created_at: new Date().toISOString() })
          .eq("comment_id", body.commentId)
          .eq("user_id", user.id);

        if (updateError) {
          // eslint-disable-next-line no-console
          console.error("[posts/comment-reactions] Failed to update comment reaction", { commentId: body.commentId, userId: user.id, updateError });
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      } else {
        const { error: insertError } = await adminClient.from("post_comment_reactions").insert({
          comment_id: body.commentId,
          user_id: user.id,
          emoji,
        });

        if (insertError) {
          // eslint-disable-next-line no-console
          console.error("[posts/comment-reactions] Failed to insert comment reaction", { commentId: body.commentId, userId: user.id, insertError });
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }

      const interaction = await loadRelationalInteraction(adminClient, body.postId, user.id, viewerIsAdmin);
      return NextResponse.json({ interaction, storage: "relational" });
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
    const existingCommentReactions = getStoredCommentReactions(existingThemeSettings);
    const legacyCurrentReaction = existingCommentReactions.find((reaction) => reaction.comment_id === body.commentId);
    const nextCommentReactions = existingCommentReactions.filter((reaction) => reaction.comment_id !== body.commentId);

    if (!legacyCurrentReaction || legacyCurrentReaction.emoji !== emoji) {
      nextCommentReactions.push({
        comment_id: body.commentId,
        post_id: body.postId,
        emoji,
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
          post_reactions: getStoredPostReactions(existingThemeSettings),
          comment_reactions: nextCommentReactions,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

    if (profileError) {
      // eslint-disable-next-line no-console
      console.error("[posts/comment-reactions] Failed to upsert profile for legacy comment reaction", { userId: user.id, profileError });
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, body.postId, user.id);
    return NextResponse.json({ interaction, storage: "legacy" });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("[posts/comment-reactions] Unhandled exception in POST handler", { error });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save comment reaction." },
      { status: 500 }
    );
  }
}