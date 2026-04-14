import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, loadProfileStatus, isMuted, userIsAdmin } from "@/lib/admin-utils";
import {
  getStoredCommentReactions,
  buildInteractionsFromRows,
  countInteractionReactions,
  getStoredPostComments,
  getStoredPostReactions,
  isMissingInteractionTablesError,
  normalizeThemeSettings,
  type ReactionEmoji,
} from "@/lib/post-interactions";
import { normalizeCustomEmojiStorageValue } from "@/lib/custom-emojis";
import { loadLegacyInteraction, loadRelationalInteraction } from "@/lib/post-interaction-loaders";
import { getCustomEmojiFileNameSet } from "@/lib/custom-emoji-registry";
import { sendPushNotificationsForSources } from "@/lib/push-notifications";

import { resolveProfileUsername } from "@/lib/profile-identity";

type ReactionBody = {
  postId?: string;
  emoji?: ReactionEmoji;
};

type ReactionsGetResponse = {
  interactionsByPostId: Record<string, any>;
  storage?: "relational" | "legacy";
  degraded?: boolean;
};

function isShopListingPostId(postId?: string | null) {
  return typeof postId === "string" && postId.startsWith("shop-product-");
}

function extractShopListingOwnerId(postId: string) {
  const match = /^shop-product-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-/i.exec(postId);
  return match?.[1] ?? null;
}

export async function GET(req: NextRequest) {
  const postIds = (req.nextUrl.searchParams.get("postIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const emptyPayload: ReactionsGetResponse = { interactionsByPostId: {} };
  if (!postIds.length) {
    return NextResponse.json(emptyPayload);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("[posts/reactions] Missing service role configuration in GET", { error });
      return NextResponse.json({ ...emptyPayload, degraded: true });
    }

    const viewerIsAdmin = user ? await userIsAdmin(adminClient, user.id) : false;
    const relationalPostIds = postIds.filter((postId) => !isShopListingPostId(postId));
    const shopListingPostIds = postIds.filter((postId) => isShopListingPostId(postId));

    try {
      const interactionByPostId: Record<string, any> = {};

      if (relationalPostIds.length) {
        const loaded = await Promise.all(relationalPostIds.map((postId) => loadRelationalInteraction(adminClient, postId, user?.id || null, viewerIsAdmin)));
        relationalPostIds.forEach((postId, index) => {
          interactionByPostId[postId] = loaded[index] ?? { comments: [], reactions: [], viewerReaction: null };
        });
      }

      if (shopListingPostIds.length) {
        const loadedShopListings = await Promise.all(shopListingPostIds.map((postId) => loadLegacyInteraction(adminClient, postId, user?.id || null)));
        shopListingPostIds.forEach((postId, index) => {
          interactionByPostId[postId] = loadedShopListings[index] ?? { comments: [], reactions: [], viewerReaction: null };
        });
      }

      return NextResponse.json({ interactionsByPostId: interactionByPostId, storage: relationalPostIds.length ? "relational" : "legacy" });
    } catch (error: any) {
      if (!isMissingInteractionTablesError(error)) {
        console.error("[posts/reactions] Relational GET failed; returning degraded payload", { error: error?.message || error });
        return NextResponse.json({ ...emptyPayload, degraded: true });
      }
    }

    const interactionByPostId: Record<string, any> = {};
    const loadedLegacy = await Promise.all(postIds.map((postId) => loadLegacyInteraction(adminClient, postId, user?.id || null)));
    postIds.forEach((postId, index) => {
      interactionByPostId[postId] = loadedLegacy[index] ?? { comments: [], reactions: [], viewerReaction: null };
    });
    return NextResponse.json({ interactionsByPostId: interactionByPostId, storage: "legacy" });
  } catch (error: any) {
    console.error("[posts/reactions] Unhandled GET failure; returning degraded payload", { error: error?.message || error });
    return NextResponse.json({ interactionsByPostId: {}, degraded: true });
  }
}

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
  actorHandle: string,
  postId: string,
  emoji: ReactionEmoji
) {
  if (!ownerId || ownerId === actorId) {
    return;
  }

  const payload = {
    user_id: ownerId,
    actor_name: actorHandle,
    type: "like",
    post_id: postId,
    message: `@${actorHandle} reacted with ${emoji} to your post.`,
    read: false,
  };

  try {
    const notificationId = await insertNotificationRecord(adminClient, payload);
    if (!notificationId) {
      return null;
    }

    return {
      user_id: ownerId,
      actor_name: actorHandle,
      type: "like",
      message: `@${actorHandle} reacted with ${emoji} to your post.`,
      post_id: postId,
    };
  } catch (error: any) {
    console.error("[notifications] Failed to create like notification", {
      ownerId,
      actorId,
      postId,
      emoji,
      error: error?.message || error,
    });
    return null;
  }
}


export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();


  if (authError || !user) {
    // eslint-disable-next-line no-console
    console.error("[posts/reactions] Auth error or missing user", { authError });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as ReactionBody;
  const normalizedEmoji = normalizeCustomEmojiStorageValue(body.emoji);
  const allowedEmojiSet = await getCustomEmojiFileNameSet();
  const normalizedEmojiFileName = normalizedEmoji?.replace(/^\/emojis\//i, "");

  if (!body.postId || !normalizedEmoji || !normalizedEmojiFileName || !allowedEmojiSet.has(normalizedEmojiFileName)) {
    // eslint-disable-next-line no-console
    console.error("[posts/reactions] Invalid reaction emoji", {
      postId: body.postId,
      emoji: body.emoji,
      normalizedEmoji,
      validEmojiCount: allowedEmojiSet.size,
    });
    return NextResponse.json({ error: "Post ID and valid emoji are required." }, { status: 400 });
  }

  const emoji = normalizedEmoji;
  const shopListingOwnerId = body.postId ? extractShopListingOwnerId(body.postId) : null;
  const isShopListing = isShopListingPostId(body.postId);

  try {
    const adminClient = createAdminClient();
    const viewerIsAdmin = await userIsAdmin(adminClient, user.id);
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      // eslint-disable-next-line no-console
      console.error("[posts/reactions] User is muted", { userId: user.id });
      return NextResponse.json({ error: "You are muted and cannot react at this time." }, { status: 403 });
    }

    let postOwnerId: string | null = null;
    if (isShopListing) {
      if (!shopListingOwnerId) {
        return NextResponse.json({ error: "Post not found." }, { status: 404 });
      }
      postOwnerId = shopListingOwnerId;
    } else {
      const { data: post, error: postError } = await adminClient
        .from("posts")
        .select("id, user_id")
        .eq("id", body.postId)
        .is("deleted_at", null)
        .maybeSingle();

      if (postError || !post) {
        // eslint-disable-next-line no-console
        console.error("[posts/reactions] Post not found", { postId: body.postId, postError });
        return NextResponse.json({ error: "Post not found." }, { status: 404 });
      }

      postOwnerId = post.user_id;
    }

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();

    const actorHandle = resolveProfileUsername(
      actorProfile?.username,
      user.user_metadata?.username,
      user.email,
      user.id
    ).replace(/^@+/, "");

    const { data: currentReaction, error: currentReactionError } = isShopListing
      ? { data: null, error: { code: "PGRST205", message: "shop listing uses legacy storage" } as any }
      : await adminClient
          .from("post_reactions")
          .select("emoji")
          .eq("post_id", body.postId)
          .eq("user_id", user.id)
          .maybeSingle();

    if (!currentReactionError) {
      let shouldNotify = false;

      if (currentReaction?.emoji === emoji) {
        const { error: deleteError } = await adminClient
          .from("post_reactions")
          .delete()
          .eq("post_id", body.postId)
          .eq("user_id", user.id);

        if (deleteError) {
          // eslint-disable-next-line no-console
          console.error("[posts/reactions] Failed to delete reaction", { postId: body.postId, userId: user.id, deleteError });
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }
      } else if (currentReaction) {
        const { error: updateError } = await adminClient
          .from("post_reactions")
          .update({ emoji, created_at: new Date().toISOString() })
          .eq("post_id", body.postId)
          .eq("user_id", user.id);

        if (updateError) {
          // eslint-disable-next-line no-console
          console.error("[posts/reactions] Failed to update reaction", { postId: body.postId, userId: user.id, updateError });
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
        shouldNotify = true;
      } else {
        const { error: insertError } = await adminClient.from("post_reactions").insert({
          post_id: body.postId,
          user_id: user.id,
          emoji,
        });

        if (insertError) {
          // eslint-disable-next-line no-console
          console.error("[posts/reactions] Failed to insert reaction", { postId: body.postId, userId: user.id, insertError });
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
        // eslint-disable-next-line no-console
        console.error("[posts/reactions] Failed to update post likes count", { postId: body.postId, updatePostError });
        return NextResponse.json({ error: updatePostError.message }, { status: 500 });
      }

      if (shouldNotify) {
        const pushSource = await createLikeNotification(adminClient, postOwnerId, user.id, actorHandle, body.postId, emoji);
        if (pushSource) {
          try {
            await sendPushNotificationsForSources(adminClient, [pushSource]);
          } catch (pushError) {
            console.error("[push] Failed to send post reaction push notification", pushError);
          }
        }
      }

      return NextResponse.json({ interaction, likesCount, storage: "relational" });
    }

    if (!isMissingInteractionTablesError(currentReactionError)) {
      // eslint-disable-next-line no-console
      console.error("[posts/reactions] Unexpected error loading current reaction", { postId: body.postId, userId: user.id, currentReactionError });
      return NextResponse.json({ error: currentReactionError.message }, { status: 500 });
    }

    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, verified_badge")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const existingThemeSettings = normalizeThemeSettings(existingProfile?.theme_settings);
    const existingReactions = getStoredPostReactions(existingThemeSettings);
    const legacyCurrentReaction = existingReactions.find((reaction) => reaction.post_id === body.postId);
    const nextReactions = existingReactions.filter((reaction) => reaction.post_id !== body.postId);
    const shouldNotify = !legacyCurrentReaction || legacyCurrentReaction.emoji !== emoji;

    if (!legacyCurrentReaction || legacyCurrentReaction.emoji !== emoji) {
      nextReactions.push({
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
        verified_badge: existingProfile?.verified_badge ?? false,
        theme_settings: {
          ...existingThemeSettings,
          post_comments: getStoredPostComments(existingThemeSettings),
          post_reactions: nextReactions,
          comment_reactions: getStoredCommentReactions(existingThemeSettings),
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

    if (profileError) {
      // eslint-disable-next-line no-console
      console.error("[posts/reactions] Failed to upsert profile for legacy reaction", { userId: user.id, profileError });
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const interaction = await loadLegacyInteraction(adminClient, body.postId, user.id);
    const likesCount = countInteractionReactions(interaction);

    if (!isShopListing) {
      const { error: updatePostError } = await adminClient
        .from("posts")
        .update({ likes: likesCount })
        .eq("id", body.postId);

      if (updatePostError) {
        // eslint-disable-next-line no-console
        console.error("[posts/reactions] Failed to update post likes count (legacy)", { postId: body.postId, updatePostError });
        return NextResponse.json({ error: updatePostError.message }, { status: 500 });
      }
    }

    if (shouldNotify) {
      const pushSource = await createLikeNotification(adminClient, postOwnerId, user.id, actorHandle, body.postId, emoji);
      if (pushSource) {
        try {
          await sendPushNotificationsForSources(adminClient, [pushSource]);
        } catch (pushError) {
          console.error("[push] Failed to send legacy post reaction push notification", pushError);
        }
      }
    }

    return NextResponse.json({ interaction, likesCount, storage: "legacy" });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error("[posts/reactions] Unhandled exception in POST handler", { error });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save reaction." },
      { status: 500 }
    );
  }
}