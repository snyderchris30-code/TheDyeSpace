import { createAdminClient, isShadowBanned, isVoided } from "@/lib/admin-utils";
import {
  buildInteractionsByPost,
  buildInteractionsFromRows,
  isMissingInteractionTablesError,
  type InteractionProfileRow,
  type RelationalCommentReactionRow,
  type RelationalPostCommentRow,
  type RelationalPostReactionRow,
} from "@/lib/post-interactions";

type AdminClient = ReturnType<typeof createAdminClient>;
type InteractionProfileWithStatus = InteractionProfileRow & {
  voided_until?: string | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  ghost_ridin?: boolean | null;
};

function maskGhostProfileIdentity(
  profile: InteractionProfileWithStatus,
  viewerId?: string | null,
  viewerIsAdmin = false
): InteractionProfileWithStatus {
  if (!profile?.ghost_ridin || viewerIsAdmin || (viewerId && viewerId === profile.id)) {
    return profile;
  }

  return {
    ...profile,
    username: null,
    display_name: "Ghost Rider",
    verified_badge: false,
    member_number: null,
  };
}

async function loadInteractionProfiles(adminClient: AdminClient, userIds: string[]) {
  if (!userIds.length) {
    return [] as InteractionProfileWithStatus[];
  }

  const primaryProfileResponse = await adminClient
    .from("profiles")
    .select("id, username, display_name, avatar_url, verified_badge, member_number, theme_settings, voided_until, shadow_banned, shadow_banned_until, ghost_ridin")
    .in("id", userIds);

  const missingStatusColumns = String(primaryProfileResponse.error?.message || "").includes("Could not find the")
    && (String(primaryProfileResponse.error?.message || "").includes("voided_until")
      || String(primaryProfileResponse.error?.message || "").includes("shadow_banned")
      || String(primaryProfileResponse.error?.message || "").includes("shadow_banned_until"));

  let profileRows = primaryProfileResponse.data;
  let profilesError = primaryProfileResponse.error;

  if (missingStatusColumns) {
    const fallbackProfileResponse = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url, verified_badge, member_number, theme_settings")
      .in("id", userIds);
    profileRows = fallbackProfileResponse.data as typeof profileRows;
    profilesError = fallbackProfileResponse.error;
  }

  if (profilesError) {
    throw profilesError;
  }

  return (profileRows || []) as InteractionProfileWithStatus[];
}

async function loadRelationalComments(adminClient: AdminClient, postIds: string[]) {
  let commentsResponse = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .in("post_id", postIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const missingDeletedAt = String(commentsResponse.error?.message || "").includes("Could not find the 'deleted_at' column");
  if (missingDeletedAt) {
    commentsResponse = await adminClient
      .from("post_comments")
      .select("id, post_id, user_id, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: true });
  }

  if (commentsResponse.error) {
    throw commentsResponse.error;
  }

  return (commentsResponse.data || []) as RelationalPostCommentRow[];
}

async function loadRelationalPostReactions(adminClient: AdminClient, postIds: string[]) {
  const { data, error } = await adminClient
    .from("post_reactions")
    .select("post_id, user_id, emoji, created_at")
    .in("post_id", postIds);

  if (error) {
    throw error;
  }

  return (data || []) as RelationalPostReactionRow[];
}

async function loadRelationalCommentReactions(adminClient: AdminClient, commentIds: string[]) {
  if (!commentIds.length) {
    return [] as RelationalCommentReactionRow[];
  }

  const { data, error } = await adminClient
    .from("post_comment_reactions")
    .select("comment_id, user_id, emoji, created_at")
    .in("comment_id", commentIds);

  if (error) {
    if (isMissingInteractionTablesError(error)) {
      return [] as RelationalCommentReactionRow[];
    }

    throw error;
  }

  return (data || []) as RelationalCommentReactionRow[];
}

export async function loadLegacyInteractions(
  adminClient: AdminClient,
  postIds: string[],
  viewerId?: string | null,
  viewerIsAdmin = false
) {
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, avatar_url, verified_badge, member_number, theme_settings, ghost_ridin");

  if (error) {
    throw error;
  }

  const safeProfiles = (profiles || []) as InteractionProfileWithStatus[];
  const maskedProfiles = safeProfiles.map((profile) => maskGhostProfileIdentity(profile, viewerId, viewerIsAdmin));
  return buildInteractionsByPost(maskedProfiles as InteractionProfileRow[], postIds, viewerId);
}

export async function loadLegacyInteraction(adminClient: AdminClient, postId: string, viewerId?: string | null) {
  return (await loadLegacyInteractions(adminClient, [postId], viewerId, false))[postId];
}

export async function loadRelationalInteractions(
  adminClient: AdminClient,
  postIds: string[],
  viewerId?: string | null,
  viewerIsAdmin = false
) {
  const comments = await loadRelationalComments(adminClient, postIds);
  const reactions = await loadRelationalPostReactions(adminClient, postIds);
  const commentReactions = await loadRelationalCommentReactions(adminClient, comments.map((comment) => comment.id));

  const userIds = [
    ...new Set([
      ...comments.map((comment) => comment.user_id),
      ...reactions.map((reaction) => reaction.user_id),
      ...commentReactions.map((reaction) => reaction.user_id),
    ]),
  ];

  const profiles = await loadInteractionProfiles(adminClient, userIds);
  const maskedProfiles = profiles.map((profile) => maskGhostProfileIdentity(profile, viewerId, viewerIsAdmin));

  if (!viewerIsAdmin) {
    const voidedAuthors = new Set(profiles.filter((profile) => isVoided(profile)).map((profile) => profile.id));
    const shadowBannedAuthors = new Set(profiles.filter((profile) => isShadowBanned(profile)).map((profile) => profile.id));

    const visibleComments = comments.filter((comment) => {
      if (comment.user_id === viewerId) {
        return true;
      }

      return !voidedAuthors.has(comment.user_id) && !shadowBannedAuthors.has(comment.user_id);
    });

    const visibleCommentIds = new Set(visibleComments.map((comment) => comment.id));

    return buildInteractionsFromRows(
      postIds,
      visibleComments,
      reactions.filter((reaction) => reaction.user_id === viewerId || !shadowBannedAuthors.has(reaction.user_id)),
      commentReactions.filter((reaction) => visibleCommentIds.has(reaction.comment_id) && (reaction.user_id === viewerId || !shadowBannedAuthors.has(reaction.user_id))),
      maskedProfiles,
      viewerId
    );
  }

  return buildInteractionsFromRows(postIds, comments, reactions, commentReactions, maskedProfiles, viewerId);
}

export async function loadRelationalInteraction(
  adminClient: AdminClient,
  postId: string,
  viewerId?: string | null,
  viewerIsAdmin = false
) {
  return (await loadRelationalInteractions(adminClient, [postId], viewerId, viewerIsAdmin))[postId];
}