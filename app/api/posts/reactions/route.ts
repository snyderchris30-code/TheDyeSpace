import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

type ReactionBody = {
  postId?: string;
  emoji?: ReactionEmoji;
};

function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });
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

async function loadRelationalInteraction(adminClient: ReturnType<typeof createAdminClient>, postId: string, viewerId?: string | null) {
  const { data: comments, error: commentsError } = await adminClient
  import { resolveProfileUsername } from "@/lib/profile-identity";
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .eq("post_id", postId)
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
  let profiles: InteractionProfileRow[] = [];

  if (userIds.length) {
    const { data: profileRows, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    profiles = (profileRows || []) as InteractionProfileRow[];
  }

  return buildInteractionsFromRows(
    [postId],
    (comments || []) as RelationalPostCommentRow[],
    (reactions || []) as RelationalPostReactionRow[],
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
    const { data: post, error: postError } = await adminClient.from("posts").select("id").eq("id", body.postId).maybeSingle();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }

    const { data: currentReaction, error: currentReactionError } = await adminClient
      .from("post_reactions")
      .select("emoji")
      .eq("post_id", body.postId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!currentReactionError) {
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
      } else {
        const { error: insertError } = await adminClient.from("post_reactions").insert({
          post_id: body.postId,
          user_id: user.id,
          emoji: body.emoji,
        });

        if (insertError) {
          return NextResponse.json({ error: insertError.message }, { status: 500 });
        }
      }

      const interaction = await loadRelationalInteraction(adminClient, body.postId, user.id);
      const likesCount = countInteractionReactions(interaction);

      const { error: updatePostError } = await adminClient
        .from("posts")
        .update({ likes: likesCount })
        .eq("id", body.postId);

      if (updatePostError) {
        return NextResponse.json({ error: updatePostError.message }, { status: 500 });
      }

      return NextResponse.json({ interaction, likesCount, storage: "relational" });
    }

    if (!isMissingInteractionTablesError(currentReactionError)) {
      return NextResponse.json({ error: currentReactionError.message }, { status: 500 });
    }

    const { data: existingProfile } = await adminClient
          username: resolveProfileUsername(existingProfile?.username, user.user_metadata?.username, user.email, user.id),
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const existingThemeSettings = normalizeThemeSettings(existingProfile?.theme_settings);
    const existingReactions = getStoredPostReactions(existingThemeSettings);
    const legacyCurrentReaction = existingReactions.find((reaction) => reaction.post_id === body.postId);
    const nextReactions = existingReactions.filter((reaction) => reaction.post_id !== body.postId);

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
        username: existingProfile?.username ?? user.user_metadata?.username ?? user.email ?? "",
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

    return NextResponse.json({ interaction, likesCount, storage: "legacy" });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save reaction." },
      { status: 500 }
    );
  }
}