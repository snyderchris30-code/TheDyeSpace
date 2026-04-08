/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_USER_UID = "794077c7-ad51-47cc-8c25-20171edfb017";
const LOOKBACK_MINUTES = 120;
const MAX_POSTS = 15;
const MAX_COMMENTS = 20;
const MAX_REACTIONS = 15;
const MAX_PROFILES = 15;
const AI_BATCH_SIZE = 20;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.68;
const SAFE_IMAGE_ONLY_LABEL = "Image-only post; no text caption available.";
const MODERATION_SIGNAL_REGEX = /(special dye|party favors?|plug|telegram|signal app|cashapp|venmo|bitcoin|crypto|grams?|overnight|vendor|official store|customer service|threat|kill yourself|white power|kkk|nazi|impersonat|fraud|scam)/i;

type ModerationCategory =
  | "drug_or_illegal"
  | "spam_scam_impersonation"
  | "hate_or_harassment"
  | "community_suspicious";

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  created_at: string;
};

type PostRow = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  created_at: string;
  deleted_at?: string | null;
};

type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  content: string | null;
  created_at: string;
  deleted_at?: string | null;
};

type PostReactionRow = {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type CommentReactionRow = {
  comment_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type CandidateEntityType = "post" | "comment" | "post_reaction" | "comment_reaction" | "profile";

type CandidateItem = {
  candidateId: string;
  entityType: CandidateEntityType;
  entityId: string;
  relatedPostId: string | null;
  relatedCommentId: string | null;
  relatedProfileId: string | null;
  actorUserId: string | null;
  contentUrl: string;
  excerpt: string | null;
  sourceCreatedAt: string;
  promptText: string;
  metadata: Record<string, unknown>;
};

type DailyReportFlag = {
  entity_type: string;
  content_url: string;
  excerpt: string | null;
  reason: string;
  confidence_score: number | string;
  categories: string[] | null;
  status: string;
};

type AiProvider = "openai" | "grok";

type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  apiUrl: string;
  confidenceThreshold: number;
};

type AiFlagResponse = {
  flaggedItems?: Array<{
    itemId?: string;
    suspicious?: boolean;
    confidence?: number | string;
    categories?: unknown;
    reason?: string;
  }>;
};

type RunSummary = {
  scannedPosts: number;
  scannedComments: number;
  scannedReactions: number;
  scannedProfiles: number;
  candidateCount: number;
  flaggedCount: number;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function ensureEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function truncateText(value: string | null | undefined, maxLength = 240) {
  const text = (value || "").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function basenamePath(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return "unknown";
  const parts = text.split("/").filter(Boolean);
  return parts[parts.length - 1] || text;
}

function formatDisplayName(profile?: Partial<ProfileRow> | null) {
  const displayName = typeof profile?.display_name === "string" ? profile.display_name.trim() : "";
  if (displayName) return displayName;
  const username = typeof profile?.username === "string" ? profile.username.trim().replace(/^@+/, "") : "";
  if (username) return `@${username}`;
  return "DyeSpace User";
}

function normalizeUsername(value: string | null | undefined) {
  const username = (value || "").trim().replace(/^@+/, "");
  return username || null;
}

function buildProfileUrl(profile: Pick<ProfileRow, "id" | "username">) {
  const username = normalizeUsername(profile.username);
  if (username) {
    return `/profile/${encodeURIComponent(username)}`;
  }

  return `/explore?profileId=${encodeURIComponent(profile.id)}`;
}

function buildPostUrl(postId: string) {
  return `/explore?postId=${encodeURIComponent(postId)}`;
}

function buildCommentUrl(postId: string | null, commentId: string) {
  const params = new URLSearchParams();
  if (postId) {
    params.set("postId", postId);
  }
  params.set("commentId", commentId);
  return `/explore?${params.toString()}`;
}

function buildPostReactionUrl(postId: string, userId: string) {
  const params = new URLSearchParams({ postId, reactionUserId: userId });
  return `/explore?${params.toString()}`;
}

function buildCommentReactionUrl(postId: string | null, commentId: string, userId: string) {
  const params = new URLSearchParams({ commentId, reactionUserId: userId });
  if (postId) {
    params.set("postId", postId);
  }
  return `/explore?${params.toString()}`;
}

function buildReactionEntityId(targetId: string, userId: string) {
  return `${targetId}:${userId}`;
}

function normalizeCategories(input: unknown): ModerationCategory[] {
  if (!Array.isArray(input)) {
    return ["community_suspicious"];
  }

  const normalized = input
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .map((value) => {
      if (value === "drug_or_illegal") return value;
      if (value === "spam_scam_impersonation") return value;
      if (value === "hate_or_harassment") return value;
      if (value === "community_suspicious") return value;
      if (value.includes("drug") || value.includes("illegal")) return "drug_or_illegal";
      if (value.includes("spam") || value.includes("scam") || value.includes("imperson")) return "spam_scam_impersonation";
      if (value.includes("hate") || value.includes("harass") || value.includes("threat")) return "hate_or_harassment";
      return "";
    })
    .filter((value): value is ModerationCategory => Boolean(value));

  return normalized.length ? [...new Set(normalized)] : ["community_suspicious"];
}

function normalizeConfidence(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONFIDENCE_THRESHOLD;
  }

  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return Number(parsed.toFixed(3));
}

function normalizeAiReason(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "Suspicious activity needs admin review.";
  return truncateText(text, 220) || "Suspicious activity needs admin review.";
}

function containsModerationSignal(value: string | null | undefined) {
  return MODERATION_SIGNAL_REGEX.test((value || "").toLowerCase());
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function createAdminClient() {
  return createClient(ensureEnv("SUPABASE_URL"), ensureEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function loadAiConfig(): AiConfig {
  const requestedProvider = Deno.env.get("AI_WATCHER_PROVIDER")?.trim().toLowerCase();
  const hasGrokKey = Boolean(Deno.env.get("XAI_API_KEY") || Deno.env.get("GROK_API_KEY"));
  const provider: AiProvider = requestedProvider === "grok" || (!requestedProvider && hasGrokKey) ? "grok" : "openai";
  const apiKey = provider === "grok"
    ? Deno.env.get("XAI_API_KEY")?.trim() || Deno.env.get("GROK_API_KEY")?.trim() || ""
    : Deno.env.get("OPENAI_API_KEY")?.trim() || "";

  if (!apiKey) {
    throw new Error(provider === "grok" ? "Missing XAI_API_KEY or GROK_API_KEY." : "Missing OPENAI_API_KEY.");
  }

  const apiUrl = Deno.env.get("AI_WATCHER_API_URL")?.trim() || (provider === "grok" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions");
  const model = Deno.env.get("AI_WATCHER_MODEL")?.trim() || (provider === "grok" ? "grok-3-mini" : "gpt-4.1-mini");
  const thresholdValue = Number(Deno.env.get("AI_WATCHER_CONFIDENCE_THRESHOLD") || DEFAULT_CONFIDENCE_THRESHOLD);

  return {
    provider,
    model,
    apiKey,
    apiUrl,
    confidenceThreshold: Number.isFinite(thresholdValue) ? Math.min(Math.max(thresholdValue, 0), 1) : DEFAULT_CONFIDENCE_THRESHOLD,
  };
}

async function startRun(adminClient: ReturnType<typeof createAdminClient>) {
  const { data, error } = await adminClient
    .from("moderation_watch_runs")
    .insert({
      started_at: nowIso(),
      status: "running",
      metadata: { adminUserId: ADMIN_USER_UID },
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data?.id) {
    throw error || new Error("Failed to start moderation run.");
  }

  return data.id;
}

async function finishRun(
  adminClient: ReturnType<typeof createAdminClient>,
  runId: string,
  patch: Record<string, unknown>
) {
  const { error } = await adminClient
    .from("moderation_watch_runs")
    .update(patch)
    .eq("id", runId);

  if (error) {
    console.error("[ai-watcher] Failed to finalize run", { runId, error });
  }
}

async function fetchRecentContent(adminClient: ReturnType<typeof createAdminClient>, sinceIso: string) {
  const [postsResult, commentsResult, postReactionsResult, commentReactionsResult, newProfilesResult] = await Promise.all([
    adminClient
      .from("posts")
      .select("id,user_id,content,image_urls,created_at,deleted_at")
      .is("deleted_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_POSTS),
    adminClient
      .from("post_comments")
      .select("id,post_id,user_id,content,created_at,deleted_at")
      .is("deleted_at", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_COMMENTS),
    adminClient
      .from("post_reactions")
      .select("post_id,user_id,emoji,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_REACTIONS),
    adminClient
      .from("post_comment_reactions")
      .select("comment_id,user_id,emoji,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_REACTIONS),
    adminClient
      .from("profiles")
      .select("id,username,display_name,bio,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_PROFILES),
  ]);

  if (postsResult.error) throw postsResult.error;
  if (commentsResult.error) throw commentsResult.error;
  if (postReactionsResult.error) throw postReactionsResult.error;
  if (commentReactionsResult.error) throw commentReactionsResult.error;
  if (newProfilesResult.error) throw newProfilesResult.error;

  const posts = (postsResult.data || []) as PostRow[];
  const comments = (commentsResult.data || []) as CommentRow[];
  const postReactions = (postReactionsResult.data || []) as PostReactionRow[];
  const commentReactions = (commentReactionsResult.data || []) as CommentReactionRow[];
  const newProfiles = (newProfilesResult.data || []) as ProfileRow[];

  const missingCommentIds = [...new Set(commentReactions.map((reaction) => reaction.comment_id).filter((commentId) => !comments.some((comment) => comment.id === commentId)))];
  const additionalCommentsResult = missingCommentIds.length
    ? await adminClient
        .from("post_comments")
        .select("id,post_id,user_id,content,created_at,deleted_at")
        .in("id", missingCommentIds)
    : { data: [], error: null };

  if (additionalCommentsResult.error) throw additionalCommentsResult.error;

  const commentsById = new Map<string, CommentRow>();
  for (const comment of [...comments, ...((additionalCommentsResult.data || []) as CommentRow[])]) {
    if (!comment.deleted_at) {
      commentsById.set(comment.id, comment);
    }
  }

  const relatedPostIds = [...new Set([
    ...posts.map((post) => post.id),
    ...comments.map((comment) => comment.post_id),
    ...postReactions.map((reaction) => reaction.post_id),
    ...Array.from(commentsById.values()).map((comment) => comment.post_id),
  ])];

  const missingPostIds = relatedPostIds.filter((postId) => !posts.some((post) => post.id === postId));
  const additionalPostsResult = missingPostIds.length
    ? await adminClient
        .from("posts")
        .select("id,user_id,content,image_urls,created_at,deleted_at")
        .in("id", missingPostIds)
    : { data: [], error: null };

  if (additionalPostsResult.error) throw additionalPostsResult.error;

  const postsById = new Map<string, PostRow>();
  for (const post of [...posts, ...((additionalPostsResult.data || []) as PostRow[])]) {
    if (!post.deleted_at) {
      postsById.set(post.id, post);
    }
  }

  const profileIds = [...new Set([
    ...newProfiles.map((profile) => profile.id),
    ...Array.from(postsById.values()).map((post) => post.user_id),
    ...Array.from(commentsById.values()).map((comment) => comment.user_id),
    ...postReactions.map((reaction) => reaction.user_id),
    ...commentReactions.map((reaction) => reaction.user_id),
  ])];

  const missingProfileIds = profileIds.filter((profileId) => !newProfiles.some((profile) => profile.id === profileId));
  const additionalProfilesResult = missingProfileIds.length
    ? await adminClient
        .from("profiles")
        .select("id,username,display_name,bio,created_at")
        .in("id", missingProfileIds)
    : { data: [], error: null };

  if (additionalProfilesResult.error) throw additionalProfilesResult.error;

  const profilesById = new Map<string, ProfileRow>();
  for (const profile of [...newProfiles, ...((additionalProfilesResult.data || []) as ProfileRow[])]) {
    profilesById.set(profile.id, profile);
  }

  return {
    posts,
    comments,
    postReactions,
    commentReactions,
    newProfiles,
    postsById,
    commentsById,
    profilesById,
  };
}

function buildPostCandidate(post: PostRow, profilesById: Map<string, ProfileRow>): CandidateItem {
  const author = profilesById.get(post.user_id);
  const excerpt = truncateText(post.content, 260) || SAFE_IMAGE_ONLY_LABEL;
  const imageCount = Array.isArray(post.image_urls) ? post.image_urls.length : 0;

  return {
    candidateId: `post:${post.id}`,
    entityType: "post",
    entityId: post.id,
    relatedPostId: post.id,
    relatedCommentId: null,
    relatedProfileId: post.user_id,
    actorUserId: post.user_id,
    contentUrl: buildPostUrl(post.id),
    excerpt,
    sourceCreatedAt: post.created_at,
    promptText: `Post by ${formatDisplayName(author)}. Caption: "${excerpt}". Image count: ${imageCount}.`,
    metadata: {
      actor: {
        id: author?.id ?? post.user_id,
        username: normalizeUsername(author?.username),
        displayName: formatDisplayName(author),
      },
      author: {
        id: author?.id ?? post.user_id,
        username: normalizeUsername(author?.username),
        displayName: formatDisplayName(author),
      },
      imageCount,
    },
  };
}

function buildCommentCandidate(comment: CommentRow, postsById: Map<string, PostRow>, profilesById: Map<string, ProfileRow>): CandidateItem {
  const author = profilesById.get(comment.user_id);
  const parentPost = postsById.get(comment.post_id);
  const excerpt = truncateText(comment.content, 220) || "Comment text unavailable.";
  const parentExcerpt = truncateText(parentPost?.content, 160) || SAFE_IMAGE_ONLY_LABEL;

  return {
    candidateId: `comment:${comment.id}`,
    entityType: "comment",
    entityId: comment.id,
    relatedPostId: comment.post_id,
    relatedCommentId: comment.id,
    relatedProfileId: comment.user_id,
    actorUserId: comment.user_id,
    contentUrl: buildCommentUrl(comment.post_id, comment.id),
    excerpt,
    sourceCreatedAt: comment.created_at,
    promptText: `Comment by ${formatDisplayName(author)}. Comment: "${excerpt}". Parent post: "${parentExcerpt}".`,
    metadata: {
      actor: {
        id: author?.id ?? comment.user_id,
        username: normalizeUsername(author?.username),
        displayName: formatDisplayName(author),
      },
      author: {
        id: author?.id ?? comment.user_id,
        username: normalizeUsername(author?.username),
        displayName: formatDisplayName(author),
      },
      parentPostExcerpt: parentExcerpt,
    },
  };
}

function shouldReviewReaction(signalText: string, activityCount: number) {
  return containsModerationSignal(signalText) || activityCount >= 6;
}

function buildPostReactionCandidate(
  reaction: PostReactionRow,
  postsById: Map<string, PostRow>,
  profilesById: Map<string, ProfileRow>,
  reactionCounts: Map<string, number>
): CandidateItem | null {
  const actor = profilesById.get(reaction.user_id);
  const targetPost = postsById.get(reaction.post_id);
  if (!targetPost) return null;

  const targetAuthor = profilesById.get(targetPost.user_id);
  const emojiLabel = basenamePath(reaction.emoji);
  const postExcerpt = truncateText(targetPost.content, 160) || SAFE_IMAGE_ONLY_LABEL;
  const signalText = [actor?.username, actor?.display_name, actor?.bio, emojiLabel, postExcerpt].filter(Boolean).join(" ");
  const activityCount = reactionCounts.get(reaction.user_id) || 0;
  if (!shouldReviewReaction(signalText, activityCount)) return null;

  return {
    candidateId: `post_reaction:${buildReactionEntityId(reaction.post_id, reaction.user_id)}`,
    entityType: "post_reaction",
    entityId: buildReactionEntityId(reaction.post_id, reaction.user_id),
    relatedPostId: reaction.post_id,
    relatedCommentId: null,
    relatedProfileId: reaction.user_id,
    actorUserId: reaction.user_id,
    contentUrl: buildPostReactionUrl(reaction.post_id, reaction.user_id),
    excerpt: `Reaction ${emojiLabel} on post: ${postExcerpt}`,
    sourceCreatedAt: reaction.created_at,
    promptText: `Reaction by ${formatDisplayName(actor)}. Emoji asset: "${emojiLabel}". Target post: "${postExcerpt}".`,
    metadata: {
      actor: {
        id: actor?.id ?? reaction.user_id,
        username: normalizeUsername(actor?.username),
        displayName: formatDisplayName(actor),
      },
      author: {
        id: targetAuthor?.id ?? targetPost.user_id,
        username: normalizeUsername(targetAuthor?.username),
        displayName: formatDisplayName(targetAuthor),
      },
      emoji: reaction.emoji,
      reactionActivityCount: activityCount,
      targetPostExcerpt: postExcerpt,
    },
  };
}

function buildCommentReactionCandidate(
  reaction: CommentReactionRow,
  commentsById: Map<string, CommentRow>,
  postsById: Map<string, PostRow>,
  profilesById: Map<string, ProfileRow>,
  reactionCounts: Map<string, number>
): CandidateItem | null {
  const actor = profilesById.get(reaction.user_id);
  const targetComment = commentsById.get(reaction.comment_id);
  if (!targetComment) return null;

  const targetPost = postsById.get(targetComment.post_id);
  const targetAuthor = profilesById.get(targetComment.user_id);
  const emojiLabel = basenamePath(reaction.emoji);
  const commentExcerpt = truncateText(targetComment.content, 160) || "Comment text unavailable.";
  const postExcerpt = truncateText(targetPost?.content, 120) || SAFE_IMAGE_ONLY_LABEL;
  const signalText = [actor?.username, actor?.display_name, actor?.bio, emojiLabel, commentExcerpt, postExcerpt].filter(Boolean).join(" ");
  const activityCount = reactionCounts.get(reaction.user_id) || 0;
  if (!shouldReviewReaction(signalText, activityCount)) return null;

  return {
    candidateId: `comment_reaction:${buildReactionEntityId(reaction.comment_id, reaction.user_id)}`,
    entityType: "comment_reaction",
    entityId: buildReactionEntityId(reaction.comment_id, reaction.user_id),
    relatedPostId: targetComment.post_id,
    relatedCommentId: targetComment.id,
    relatedProfileId: reaction.user_id,
    actorUserId: reaction.user_id,
    contentUrl: buildCommentReactionUrl(targetComment.post_id, targetComment.id, reaction.user_id),
    excerpt: `Reaction ${emojiLabel} on comment: ${commentExcerpt}`,
    sourceCreatedAt: reaction.created_at,
    promptText: `Reaction by ${formatDisplayName(actor)}. Emoji asset: "${emojiLabel}". Target comment: "${commentExcerpt}". Parent post: "${postExcerpt}".`,
    metadata: {
      actor: {
        id: actor?.id ?? reaction.user_id,
        username: normalizeUsername(actor?.username),
        displayName: formatDisplayName(actor),
      },
      author: {
        id: targetAuthor?.id ?? targetComment.user_id,
        username: normalizeUsername(targetAuthor?.username),
        displayName: formatDisplayName(targetAuthor),
      },
      emoji: reaction.emoji,
      reactionActivityCount: activityCount,
      targetCommentExcerpt: commentExcerpt,
      parentPostExcerpt: postExcerpt,
    },
  };
}

function buildProfileCandidate(profile: ProfileRow): CandidateItem {
  const username = normalizeUsername(profile.username);
  const displayName = formatDisplayName(profile);
  const bioExcerpt = truncateText(profile.bio, 220) || "No bio provided.";

  return {
    candidateId: `profile:${profile.id}`,
    entityType: "profile",
    entityId: profile.id,
    relatedPostId: null,
    relatedCommentId: null,
    relatedProfileId: profile.id,
    actorUserId: profile.id,
    contentUrl: buildProfileUrl(profile),
    excerpt: `Username: ${username || "(none)"}. Display name: ${displayName}. Bio: ${bioExcerpt}`,
    sourceCreatedAt: profile.created_at,
    promptText: `New profile. Username: "${username || "(none)"}". Display name: "${displayName}". Bio: "${bioExcerpt}".`,
    metadata: {
      actor: {
        id: profile.id,
        username,
        displayName,
      },
      author: {
        id: profile.id,
        username,
        displayName,
      },
      bio: bioExcerpt,
    },
  };
}

function buildCandidates(content: Awaited<ReturnType<typeof fetchRecentContent>>) {
  const reactionCounts = new Map<string, number>();
  for (const reaction of [...content.postReactions, ...content.commentReactions]) {
    reactionCounts.set(reaction.user_id, (reactionCounts.get(reaction.user_id) || 0) + 1);
  }

  const candidates: CandidateItem[] = [];

  for (const post of content.posts) {
    candidates.push(buildPostCandidate(post, content.profilesById));
  }

  for (const comment of content.comments) {
    candidates.push(buildCommentCandidate(comment, content.postsById, content.profilesById));
  }

  for (const reaction of content.postReactions) {
    const candidate = buildPostReactionCandidate(reaction, content.postsById, content.profilesById, reactionCounts);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const reaction of content.commentReactions) {
    const candidate = buildCommentReactionCandidate(reaction, content.commentsById, content.postsById, content.profilesById, reactionCounts);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const profile of content.newProfiles) {
    candidates.push(buildProfileCandidate(profile));
  }

  return candidates.sort((left, right) => right.sourceCreatedAt.localeCompare(left.sourceCreatedAt));
}

function extractJsonFromResponse(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("AI response was empty.");
  }

  try {
    return JSON.parse(trimmed) as AiFlagResponse;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("AI response did not contain a JSON object.");
    }
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as AiFlagResponse;
  }
}

function extractAssistantText(payload: Record<string, unknown>) {
  const rawChoices = payload.choices;
  if (!Array.isArray(rawChoices) || !rawChoices.length) {
    return "";
  }

  const firstChoice = rawChoices[0] as { message?: { content?: unknown } };
  const content = firstChoice?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

async function analyzeCandidatesWithAi(candidates: CandidateItem[], aiConfig: AiConfig) {
  const flaggedCandidates: CandidateItem[] = [];
  const candidateMap = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));

  for (const batch of chunkArray(candidates, AI_BATCH_SIZE)) {
    const requestBody: Record<string, unknown> = {
      model: aiConfig.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You are a moderation reviewer for TheDyeSpace, a tie-dye and hippie community.",
            "Review each item conservatively and only flag items that warrant human admin review.",
            "Legitimate tie-dye, art, festival, psychedelic aesthetics, or hippie slang are not violations by themselves.",
            "Pay close attention to disguised drug sales hidden as craft or dye language, including phrases like special dye, party favors, shipping, plugs, coded sales, or off-platform payment/contact instructions.",
            "Also flag spam, scams, impersonation of real businesses, hate speech, harassment, threats, or anything suspicious for a tie-dye community.",
            "Return strict JSON only in this exact shape: {\"flaggedItems\":[{\"itemId\":\"...\",\"suspicious\":true,\"confidence\":0.0,\"categories\":[\"drug_or_illegal\"],\"reason\":\"short reason\"}]}",
            "Allowed categories are drug_or_illegal, spam_scam_impersonation, hate_or_harassment, community_suspicious.",
            "Omit safe items. Confidence must be between 0 and 1. Reasons must stay under 220 characters.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            site: "TheDyeSpace",
            community_context: "Tie-dye, hippie, handmade art, and festival-inspired social community.",
            items: batch.map((candidate) => ({
              itemId: candidate.candidateId,
              entityType: candidate.entityType,
              sourceCreatedAt: candidate.sourceCreatedAt,
              contentUrl: candidate.contentUrl,
              content: candidate.promptText,
            })),
          }),
        },
      ],
    };

    if (aiConfig.provider === "openai") {
      requestBody.response_format = { type: "json_object" };
    }

    const response = await fetch(aiConfig.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`AI provider returned ${response.status}: ${responseText}`);
    }

    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const assistantText = extractAssistantText(payload);
    const parsed = extractJsonFromResponse(assistantText);
    const batchFlaggedItems = Array.isArray(parsed.flaggedItems) ? parsed.flaggedItems : [];

    for (const item of batchFlaggedItems) {
      if (!item?.suspicious || typeof item.itemId !== "string") {
        continue;
      }

      const candidate = candidateMap.get(item.itemId);
      if (!candidate) {
        continue;
      }

      const confidence = normalizeConfidence(item.confidence);
      if (confidence < aiConfig.confidenceThreshold) {
        continue;
      }

      candidate.metadata = {
        ...candidate.metadata,
        ai: {
          provider: aiConfig.provider,
          model: aiConfig.model,
          categories: normalizeCategories(item.categories),
          confidence,
          reason: normalizeAiReason(item.reason),
        },
      };
      flaggedCandidates.push(candidate);
    }
  }

  return flaggedCandidates;
}

async function upsertFlags(adminClient: ReturnType<typeof createAdminClient>, candidates: CandidateItem[], aiConfig: AiConfig) {
  if (!candidates.length) {
    return;
  }

  const rows = candidates.map((candidate) => {
    const aiMetadata = candidate.metadata.ai as {
      categories?: unknown;
      confidence?: unknown;
      reason?: unknown;
    } | undefined;

    return {
      entity_type: candidate.entityType,
      entity_id: candidate.entityId,
      related_post_id: candidate.relatedPostId,
      related_comment_id: candidate.relatedCommentId,
      related_profile_id: candidate.relatedProfileId,
      actor_user_id: candidate.actorUserId,
      content_url: candidate.contentUrl,
      excerpt: candidate.excerpt,
      reason: normalizeAiReason(aiMetadata?.reason),
      categories: normalizeCategories(aiMetadata?.categories),
      confidence_score: normalizeConfidence(aiMetadata?.confidence),
      source_created_at: candidate.sourceCreatedAt,
      metadata: {
        ...candidate.metadata,
        aiProvider: aiConfig.provider,
        aiModel: aiConfig.model,
      },
      status: "open",
      last_seen_at: nowIso(),
      reviewed_at: null,
      reviewed_by: null,
    };
  });

  const { error } = await adminClient
    .from("moderation_flags")
    .upsert(rows, { onConflict: "entity_type,entity_id" });

  if (error) {
    throw error;
  }
}

function buildDailySummary(reportDate: string, flags: DailyReportFlag[], categoryCounts: Record<string, number>, openCount: number) {
  if (!flags.length) {
    return `AI Watcher summary for ${reportDate}: no new flags were created in the previous UTC day.`;
  }

  const categorySummary = Object.entries(categoryCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => `${category.replace(/_/g, " ")}: ${count}`)
    .join(", ");

  const topItems = flags
    .slice()
    .sort((left, right) => normalizeConfidence(right.confidence_score) - normalizeConfidence(left.confidence_score))
    .slice(0, 3)
    .map((flag) => `- ${flag.entity_type}: ${normalizeAiReason(flag.reason)} (${Math.round(normalizeConfidence(flag.confidence_score) * 100)}%)`)
    .join("\n");

  return [
    `AI Watcher summary for ${reportDate}: ${flags.length} flags detected, ${openCount} still open.`,
    categorySummary ? `Categories: ${categorySummary}.` : null,
    topItems ? `Highest-confidence items:\n${topItems}` : null,
  ].filter(Boolean).join("\n\n");
}

async function createDailyReportIfNeeded(adminClient: ReturnType<typeof createAdminClient>, referenceDate: Date) {
  const reportEnd = startOfUtcDay(referenceDate);
  const reportStart = new Date(reportEnd.getTime() - 24 * 60 * 60 * 1000);
  const reportDate = formatUtcDate(reportStart);

  const existingResult = await adminClient
    .from("moderation_daily_reports")
    .select("id")
    .eq("report_date", reportDate)
    .maybeSingle<{ id: string }>();

  if (existingResult.error) {
    throw existingResult.error;
  }

  if (existingResult.data?.id) {
    return { reportDate, created: false };
  }

  const flagsResult = await adminClient
    .from("moderation_flags")
    .select("entity_type, content_url, excerpt, reason, confidence_score, categories, status")
    .gte("last_seen_at", reportStart.toISOString())
    .lt("last_seen_at", reportEnd.toISOString())
    .order("last_seen_at", { ascending: false })
    .limit(100);

  if (flagsResult.error) {
    throw flagsResult.error;
  }

  const flags = (flagsResult.data || []) as DailyReportFlag[];
  const categoryCounts: Record<string, number> = {
    drug_or_illegal: 0,
    spam_scam_impersonation: 0,
    hate_or_harassment: 0,
    community_suspicious: 0,
  };

  for (const flag of flags) {
    for (const category of normalizeCategories(flag.categories)) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }
  }

  const openCount = flags.filter((flag) => flag.status === "open").length;
  const topItems = flags
    .slice()
    .sort((left, right) => normalizeConfidence(right.confidence_score) - normalizeConfidence(left.confidence_score))
    .slice(0, 5)
    .map((flag) => ({
      entityType: flag.entity_type,
      contentUrl: flag.content_url,
      excerpt: flag.excerpt,
      reason: flag.reason,
      confidenceScore: normalizeConfidence(flag.confidence_score),
    }));

  const insertResult = await adminClient
    .from("moderation_daily_reports")
    .insert({
      report_date: reportDate,
      summary: buildDailySummary(reportDate, flags, categoryCounts, openCount),
      flagged_count: flags.length,
      open_flag_count: openCount,
      category_counts: categoryCounts,
      top_items: topItems,
    });

  if (insertResult.error) {
    throw insertResult.error;
  }

  return { reportDate, created: true };
}

function validateCronRequest(request: Request) {
  const expectedToken = Deno.env.get("AI_WATCHER_CRON_TOKEN")?.trim();
  if (!expectedToken) {
    throw new Error("Missing AI_WATCHER_CRON_TOKEN.");
  }

  const providedToken = request.headers.get("x-ai-watcher-cron-token")?.trim();
  if (!providedToken || providedToken !== expectedToken) {
    return false;
  }

  return true;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const authorized = validateCronRequest(request);
    if (!authorized) {
      return jsonResponse(401, { error: "Unauthorized." });
    }
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : "Authorization setup is incomplete.",
    });
  }

  const adminClient = createAdminClient();
  const runId = await startRun(adminClient);

  try {
    const aiConfig = loadAiConfig();
    const sinceIso = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
    const recentContent = await fetchRecentContent(adminClient, sinceIso);
    const candidates = buildCandidates(recentContent);
    const flaggedCandidates = candidates.length ? await analyzeCandidatesWithAi(candidates, aiConfig) : [];
    await upsertFlags(adminClient, flaggedCandidates, aiConfig);
    const dailyReport = await createDailyReportIfNeeded(adminClient, new Date());

    const summary: RunSummary = {
      scannedPosts: recentContent.posts.length,
      scannedComments: recentContent.comments.length,
      scannedReactions: recentContent.postReactions.length + recentContent.commentReactions.length,
      scannedProfiles: recentContent.newProfiles.length,
      candidateCount: candidates.length,
      flaggedCount: flaggedCandidates.length,
    };

    await finishRun(adminClient, runId, {
      completed_at: nowIso(),
      status: "success",
      provider: aiConfig.provider,
      model: aiConfig.model,
      scanned_posts: summary.scannedPosts,
      scanned_comments: summary.scannedComments,
      scanned_reactions: summary.scannedReactions,
      scanned_profiles: summary.scannedProfiles,
      flagged_count: summary.flaggedCount,
      metadata: {
        candidateCount: summary.candidateCount,
        dailyReportDate: dailyReport.reportDate,
        dailyReportCreated: dailyReport.created,
      },
    });

    return jsonResponse(200, {
      ok: true,
      runId,
      scanned: summary,
      dailyReportDate: dailyReport.reportDate,
      dailyReportCreated: dailyReport.created,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI watcher run failed.";
    await finishRun(adminClient, runId, {
      completed_at: nowIso(),
      status: message.includes("OPENAI_API_KEY") || message.includes("XAI_API_KEY") || message.includes("GROK_API_KEY") ? "skipped" : "error",
      error_message: message,
    });

    console.error("[ai-watcher] Run failed", { runId, error });
    return jsonResponse(500, {
      ok: false,
      error: message,
    });
  }
});