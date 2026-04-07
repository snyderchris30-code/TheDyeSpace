import { isCustomEmojiReaction } from "@/lib/custom-emojis";
import { normalizeFontStyle, type FontStyle, type ProfileAppearance } from "@/lib/profile-theme";

export type ReactionEmoji = string;

export type RelationalPostCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type RelationalPostReactionRow = {
  post_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

export type RelationalCommentReactionRow = {
  comment_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

export type StoredPostComment = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
};

export type StoredPostReaction = {
  post_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

export type StoredCommentReaction = {
  comment_id: string;
  post_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

export type LegacyThemeSettings = ProfileAppearance & {
  post_comments?: StoredPostComment[] | null;
  post_reactions?: StoredPostReaction[] | null;
  comment_reactions?: StoredCommentReaction[] | null;
  font_style?: FontStyle | null;
};

export type InteractionProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  theme_settings?: ProfileAppearance | null;
};

export type AggregatedPostComment = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  reactions: AggregatedReaction[];
  viewerReaction: ReactionEmoji | null;
  author: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    verified_badge?: boolean | null;
    member_number?: number | null;
    theme_settings?: ProfileAppearance | null;
  };
};

export type AggregatedReaction = {
  emoji: ReactionEmoji;
  count: number;
  reacted: boolean;
};

export type AggregatedPostInteraction = {
  comments: AggregatedPostComment[];
  reactions: AggregatedReaction[];
  viewerReaction: ReactionEmoji | null;
};

function createEmptyInteractions(postIds: string[]) {
  const result: Record<string, AggregatedPostInteraction> = {};
  postIds.forEach((postId) => {
    result[postId] = {
      comments: [],
      reactions: [],
      viewerReaction: null,
    };
  });
  return result;
}

export function normalizeThemeSettings(themeSettings?: LegacyThemeSettings | null): LegacyThemeSettings {
  const normalizedComments = Array.isArray(themeSettings?.post_comments)
    ? themeSettings.post_comments.filter((comment): comment is StoredPostComment => {
        return Boolean(
          comment &&
          typeof comment.id === "string" &&
          typeof comment.post_id === "string" &&
          typeof comment.content === "string" &&
          typeof comment.created_at === "string"
        );
      })
    : [];

  const normalizedReactions = Array.isArray(themeSettings?.post_reactions)
    ? themeSettings.post_reactions.filter((reaction): reaction is StoredPostReaction => {
        return Boolean(
          reaction &&
          typeof reaction.post_id === "string" &&
          typeof reaction.created_at === "string" &&
          isCustomEmojiReaction(reaction.emoji)
        );
      }).map((reaction) => ({
        ...reaction,
        emoji: reaction.emoji,
      }))
    : [];

  const normalizedCommentReactions = Array.isArray(themeSettings?.comment_reactions)
    ? themeSettings.comment_reactions.filter((reaction): reaction is StoredCommentReaction => {
        return Boolean(
          reaction &&
          typeof reaction.comment_id === "string" &&
          typeof reaction.post_id === "string" &&
          typeof reaction.created_at === "string" &&
          isCustomEmojiReaction(reaction.emoji)
        );
      }).map((reaction) => ({
        ...reaction,
        emoji: reaction.emoji,
      }))
    : [];

  return {
    background_color: themeSettings?.background_color ?? null,
    text_color: themeSettings?.text_color ?? null,
    highlight_color: themeSettings?.highlight_color ?? null,
    font_style: normalizeFontStyle(themeSettings?.font_style),
    post_comments: normalizedComments,
    post_reactions: normalizedReactions,
    comment_reactions: normalizedCommentReactions,
  };
}

export function getStoredPostComments(themeSettings?: LegacyThemeSettings | null) {
  return normalizeThemeSettings(themeSettings).post_comments ?? [];
}

export function getStoredPostReactions(themeSettings?: LegacyThemeSettings | null) {
  return normalizeThemeSettings(themeSettings).post_reactions ?? [];
}

export function getStoredCommentReactions(themeSettings?: LegacyThemeSettings | null) {
  return normalizeThemeSettings(themeSettings).comment_reactions ?? [];
}

export function isMissingInteractionTablesError(error: any) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  const code = `${error?.code || ""}`.toUpperCase();
  return code === "PGRST205" || (
    message.includes("schema cache") &&
    (message.includes("post_comments") || message.includes("post_reactions") || message.includes("post_comment_reactions"))
  );
}

function sortAggregatedReactions(reactionMap: Map<ReactionEmoji, number>, viewerReaction: ReactionEmoji | null) {
  return Array.from(reactionMap.entries())
    .sort(([leftEmoji, leftCount], [rightEmoji, rightCount]) => {
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return leftEmoji.localeCompare(rightEmoji);
    })
    .map(([emoji, count]) => ({
      emoji,
      count,
      reacted: viewerReaction === emoji,
    }));
}

export function buildInteractionsByPost(
  profiles: InteractionProfileRow[],
  postIds: string[],
  viewerId?: string | null
): Record<string, AggregatedPostInteraction> {
  const result = createEmptyInteractions(postIds);
  const reactionCounts = new Map<string, Map<ReactionEmoji, number>>();
  const commentReactionCounts = new Map<string, Map<ReactionEmoji, number>>();
  const commentViewerReactions = new Map<string, ReactionEmoji>();
  const postIdSet = new Set(postIds);

  profiles.forEach((profile) => {
    const themeSettings = normalizeThemeSettings(profile.theme_settings as LegacyThemeSettings | null | undefined);

    getStoredPostComments(themeSettings).forEach((comment) => {
      if (!postIdSet.has(comment.post_id)) {
        return;
      }

      result[comment.post_id]?.comments.push({
        id: comment.id,
        post_id: comment.post_id,
        content: comment.content,
        created_at: comment.created_at,
        reactions: [],
        viewerReaction: null,
        author: {
          id: profile.id,
          username: profile.username ?? null,
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
          verified_badge: profile.verified_badge ?? null,
          member_number: profile.member_number ?? null,
          theme_settings: themeSettings,
        },
      });
    });

    getStoredPostReactions(themeSettings).forEach((reaction) => {
      if (!postIdSet.has(reaction.post_id)) {
        return;
      }

      let postReactionMap = reactionCounts.get(reaction.post_id);
      if (!postReactionMap) {
        postReactionMap = new Map<ReactionEmoji, number>();
        reactionCounts.set(reaction.post_id, postReactionMap);
      }

      postReactionMap.set(reaction.emoji, (postReactionMap.get(reaction.emoji) || 0) + 1);

      if (viewerId && profile.id === viewerId && result[reaction.post_id]) {
        result[reaction.post_id].viewerReaction = reaction.emoji;
      }
    });

    getStoredCommentReactions(themeSettings).forEach((reaction) => {
      if (!postIdSet.has(reaction.post_id)) {
        return;
      }

      let commentReactionMap = commentReactionCounts.get(reaction.comment_id);
      if (!commentReactionMap) {
        commentReactionMap = new Map<ReactionEmoji, number>();
        commentReactionCounts.set(reaction.comment_id, commentReactionMap);
      }

      commentReactionMap.set(reaction.emoji, (commentReactionMap.get(reaction.emoji) || 0) + 1);

      if (viewerId && profile.id === viewerId) {
        commentViewerReactions.set(reaction.comment_id, reaction.emoji);
      }
    });
  });

  Object.entries(result).forEach(([postId, interaction]) => {
    interaction.comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    interaction.comments.forEach((comment) => {
      comment.viewerReaction = commentViewerReactions.get(comment.id) ?? null;
      comment.reactions = sortAggregatedReactions(
        commentReactionCounts.get(comment.id) || new Map<ReactionEmoji, number>(),
        comment.viewerReaction
      );
    });

    interaction.reactions = sortAggregatedReactions(
      reactionCounts.get(postId) || new Map<ReactionEmoji, number>(),
      interaction.viewerReaction
    );
  });

  return result;
}

export function buildInteractionsFromRows(
  postIds: string[],
  comments: RelationalPostCommentRow[],
  reactions: RelationalPostReactionRow[],
  commentReactions: RelationalCommentReactionRow[],
  profiles: InteractionProfileRow[],
  viewerId?: string | null
): Record<string, AggregatedPostInteraction> {
  const result = createEmptyInteractions(postIds);
  const profileById = new Map<string, InteractionProfileRow>();
  const reactionCounts = new Map<string, Map<ReactionEmoji, number>>();
  const commentReactionCounts = new Map<string, Map<ReactionEmoji, number>>();
  const commentViewerReactions = new Map<string, ReactionEmoji>();

  profiles.forEach((profile) => {
    profileById.set(profile.id, profile);
  });

  comments.forEach((comment) => {
    const author = profileById.get(comment.user_id);
    result[comment.post_id]?.comments.push({
      id: comment.id,
      post_id: comment.post_id,
      content: comment.content,
      created_at: comment.created_at,
      reactions: [],
      viewerReaction: null,
      author: {
        id: comment.user_id,
        username: author?.username ?? null,
        display_name: author?.display_name ?? null,
        avatar_url: author?.avatar_url ?? null,
        verified_badge: author?.verified_badge ?? null,
        member_number: author?.member_number ?? null,
        theme_settings: author?.theme_settings ?? null,
      },
    });
  });

  reactions.forEach((reaction) => {
    let postReactionMap = reactionCounts.get(reaction.post_id);
    if (!postReactionMap) {
      postReactionMap = new Map<ReactionEmoji, number>();
      reactionCounts.set(reaction.post_id, postReactionMap);
    }

    postReactionMap.set(reaction.emoji, (postReactionMap.get(reaction.emoji) || 0) + 1);

    if (viewerId && reaction.user_id === viewerId && result[reaction.post_id]) {
      result[reaction.post_id].viewerReaction = reaction.emoji;
    }
  });

  commentReactions.forEach((reaction) => {
    let commentReactionMap = commentReactionCounts.get(reaction.comment_id);
    if (!commentReactionMap) {
      commentReactionMap = new Map<ReactionEmoji, number>();
      commentReactionCounts.set(reaction.comment_id, commentReactionMap);
    }

    commentReactionMap.set(reaction.emoji, (commentReactionMap.get(reaction.emoji) || 0) + 1);

    if (viewerId && reaction.user_id === viewerId) {
      commentViewerReactions.set(reaction.comment_id, reaction.emoji);
    }
  });

  Object.entries(result).forEach(([postId, interaction]) => {
    interaction.comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    interaction.comments.forEach((comment) => {
      comment.viewerReaction = commentViewerReactions.get(comment.id) ?? null;
      comment.reactions = sortAggregatedReactions(
        commentReactionCounts.get(comment.id) || new Map<ReactionEmoji, number>(),
        comment.viewerReaction
      );
    });

    interaction.reactions = sortAggregatedReactions(
      reactionCounts.get(postId) || new Map<ReactionEmoji, number>(),
      interaction.viewerReaction
    );
  });

  return result;
}

export function countInteractionReactions(interaction?: AggregatedPostInteraction) {
  if (!interaction) return 0;
  return interaction.reactions.reduce((total, reaction) => total + reaction.count, 0);
}

