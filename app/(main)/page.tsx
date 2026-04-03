"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Heart, MessageCircle, Send, SquarePen } from "lucide-react";
import Link from "next/link";
import { useMemo, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { REACTION_EMOJIS, type AggregatedPostInteraction, type ReactionEmoji } from "@/lib/post-interactions";
import { fontClass, resolveProfileAppearance, type ProfileAppearance } from "@/lib/profile-theme";

const PAGE_SIZE = 8;

type Post = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  comments_count: number;
  is_for_sale: boolean;
  created_at: string;
  author_display_name?: string;
  author_at_name?: string;
  author_username?: string | null;
  author_theme?: ProfileAppearance | null;
};

type InteractionMap = Record<string, AggregatedPostInteraction>;

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings?: ProfileAppearance | null;
};

function isEmailLike(value: string | null | undefined) {
  if (!value) return false;
  return value.includes("@");
}

function formatAtName(profile?: ProfileRow) {
  if (!profile) return "dyespace-user";
  if (profile.display_name) return profile.display_name;
  if (profile.username && !isEmailLike(profile.username)) return profile.username;
  return "dyespace-user";
}

function formatDisplayName(profile?: ProfileRow) {
  if (!profile) return "DyeSpace User";
  if (profile.display_name) return profile.display_name;
  if (profile.username && !isEmailLike(profile.username)) return profile.username;
  return "DyeSpace User";
}

async function fetchPosts({ pageParam }: { pageParam?: string | null }) {
  const supabase = createClient();
  let query = supabase
    .from("posts")
    .select("id,user_id,content,image_urls,likes,comments_count,is_for_sale,created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (pageParam) {
    query = query.lt("created_at", pageParam);
  }

  const { data, error } = await query;
  if (error) throw error;

  const posts = (data || []) as Post[];
  if (!posts.length) return posts;

  const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))];
  if (!userIds.length) return posts;

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id,username,display_name,theme_settings")
    .in("id", userIds);

  if (profilesError) {
    // Suppress noisy error; gracefully continue with default names
    return posts.map((post) => ({
      ...post,
      author_display_name: "DyeSpace User",
      author_at_name: "dyespace-user",
    }));
  }

  const profilesById = new Map<string, ProfileRow>();
  (profilesData || []).forEach((profile) => {
    profilesById.set(profile.id, profile as ProfileRow);
  });

  return posts.map((post) => {
    const profile = profilesById.get(post.user_id);
    return {
      ...post,
      author_display_name: formatDisplayName(profile),
      author_at_name: formatAtName(profile),
      author_username: profile?.username ?? null,
      author_theme: profile?.theme_settings ?? null,
    };
  });
}

function applyPostThemeVars(element: HTMLElement | null, appearance?: ProfileAppearance | null) {
  if (!element) return;
  const resolved = resolveProfileAppearance(appearance);
  element.style.setProperty("--post-text", resolved.text_color);
  element.style.setProperty("--post-highlight", resolved.highlight_color);
}

export default function MainFeedPage() {
  const LightboxModal = dynamic(() => import("../LightboxModal"), { ssr: false });
  // Lightbox state
  const [lightbox, setLightbox] = useState<{ open: boolean; url: string | null }>({ open: false, url: null });
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, error } = useInfiniteQuery({
    queryKey: ["posts"],
    queryFn: fetchPosts,
    getNextPageParam: (lastPage) => {
      if (!lastPage?.length) return undefined;
      return lastPage[lastPage.length - 1].created_at;
    },    initialPageParam: undefined,  });

  const posts = useMemo(() => (data?.pages.flat() ?? []) as Post[], [data]);
  const [interactions, setInteractions] = useState<InteractionMap>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reactionPickerPostId, setReactionPickerPostId] = useState<string | null>(null);
  const [interactionBusyPostId, setInteractionBusyPostId] = useState<string | null>(null);

  // Supabase session detection
  const [session, setSession] = useState<any>(null);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => { listener?.subscription.unsubscribe(); };
  }, []);

  const loadInteractions = useCallback(async (postIds: string[]) => {
    if (!postIds.length) {
      setInteractions({});
      return;
    }

    const response = await fetch(`/api/posts/interactions?postIds=${encodeURIComponent(postIds.join(","))}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Failed to load post interactions.");
    }

    const body = await response.json();
    setInteractions(body.interactionsByPostId || {});
  }, []);

  useEffect(() => {
    void loadInteractions(posts.map((post) => post.id));
  }, [loadInteractions, posts]);

  const [postOverrides, setPostOverrides] = useState<Record<string, Partial<Pick<Post, "likes" | "comments_count">>>>({});

  const mergedPosts = useMemo(
    () => posts.map((post) => ({ ...post, ...(postOverrides[post.id] || {}) })),
    [postOverrides, posts]
  );

  const setPostCounts = useCallback((postId: string, updates: Partial<Pick<Post, "likes" | "comments_count">>) => {
    setPostOverrides((prev) => ({
      ...prev,
      [postId]: {
        ...(prev[postId] || {}),
        ...updates,
      },
    }));
  }, []);

  const handleReactionSelect = useCallback(
    async (postId: string, emoji: ReactionEmoji) => {
      if (!session?.user) {
        return;
      }

      setInteractionBusyPostId(postId);
      try {
        const response = await fetch("/api/posts/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, emoji }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Failed to save reaction.");
        }

        setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
        setPostCounts(postId, { likes: body.likesCount ?? 0 });
        setReactionPickerPostId(null);
      } catch (interactionError) {
        console.error(interactionError);
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [session?.user, setPostCounts]
  );

  const handleCommentSubmit = useCallback(
    async (postId: string) => {
      if (!session?.user) {
        return;
      }

      const content = commentDrafts[postId]?.trim();
      if (!content) {
        return;
      }

      setInteractionBusyPostId(postId);
      try {
        const response = await fetch("/api/posts/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, content }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Failed to save comment.");
        }

        setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
        setPostCounts(postId, { comments_count: body.commentsCount ?? 0 });
        setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
        setExpandedComments((prev) => ({ ...prev, [postId]: true }));
      } catch (interactionError) {
        console.error(interactionError);
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [commentDrafts, session?.user, setPostCounts]
  );

  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="mb-3 text-4xl leading-tight cosmic-headline sm:mb-4 sm:text-6xl lg:text-7xl">
        TheDyeSpace;] <span className="mt-2 block text-lg leading-snug cosmic-headline-sub sm:inline sm:text-[1.35rem]">The Hub For Tie-Dye Loving Hippies.</span>
      </h1>
      <div className="mb-4 sm:mb-6">
        <Link
          href={session?.user ? "/create" : "/login?redirect=/create"}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/55 bg-cyan-300/15 px-5 py-2 text-sm font-semibold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.22)] transition hover:scale-[1.02] hover:bg-cyan-300/25"
        >
          <SquarePen className="h-4 w-4" />
          Create Post
        </Link>
      </div>
      <p className="mb-5 text-base cosmic-subtext sm:mb-8 sm:text-xl">
        {/* Removed placeholder text. */}
      </p>

      {isLoading && <div className="text-teal-200">Loading cosmic posts...</div>}
      {error && <div className="text-red-300">Error loading posts: {(error as Error).message}</div>}

      <div className="grid grid-cols-1 gap-6">
        {mergedPosts.map((post) => {
          const postInteraction = interactions[post.id] || { comments: [], reactions: [], viewerReaction: null };
          const isCommentsOpen = Boolean(expandedComments[post.id]);
          const isBusy = interactionBusyPostId === post.id;

          return (
          <article
            key={post.id}
            className={`bg-gradient-to-br from-teal-900/40 via-blue-950/40 to-emerald-900/40 border fractal-border rounded-[1.5rem] p-4 transition hover:-translate-y-1 hover:shadow-2xl sm:rounded-3xl sm:p-5 ${fontClass(post.author_theme?.font_style)}`}
            ref={(element) => applyPostThemeVars(element, post.author_theme)}
          >
            <header className="mb-3 flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
              <div>
                <Link
                  href={post.author_username ? `/profile/${post.author_username}` : '#'}
                  className="font-bold text-[color:var(--post-text)] hover:text-[color:var(--post-highlight)] hover:underline"
                  prefetch={false}
                >
                  {post.author_display_name || "DyeSpace User"}
                </Link>
                <Link
                  href={post.author_username ? `/profile/${post.author_username}` : '#'}
                  className="ml-1 text-xs text-[color:var(--post-highlight)]/85 hover:text-[color:var(--post-highlight)] hover:underline"
                  prefetch={false}
                >
                  @{post.author_username || "dyespace-user"}
                </Link>
                <time className="block text-xs text-[color:var(--post-text)]/70">{new Date(post.created_at).toLocaleString()}</time>
              </div>
              <span className="rounded-full bg-green-900/30 px-2 py-1 text-xs text-green-200">{post.is_for_sale ? "For Sale" : "Just Shared"}</span>
            </header>
            <div className="block w-full text-left">
              <button
                type="button"
                className="block w-full text-left hover:opacity-80 transition"
                onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
              >
                <p className="mb-3 text-sm leading-6 text-[color:var(--post-text)]/92 sm:text-base sm:leading-7">{post.content || "No description provided yet."}</p>
              </button>
              {post.image_urls && post.image_urls.length > 0 && (
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                  {post.image_urls.map((imgUrl, idx) => (
                    <button key={idx} type="button" className="group relative aspect-[4/5] w-full overflow-hidden rounded-2xl cursor-zoom-in sm:aspect-[4/4]" onClick={() => {
                      setLightbox({ open: true, url: imgUrl });
                    }}>
                      <img
                        src={imgUrl}
                        alt={`Post image ${idx + 1}`}
                        className="absolute inset-0 h-full w-full border border-cyan-500/40 object-cover transition duration-200 group-hover:scale-105"
                        tabIndex={0}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-3 py-4 text-left text-xs text-cyan-50/85 sm:text-sm">
                        Tap to expand
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lightbox.open && lightbox.url && (
              <LightboxModal imageUrl={lightbox.url} onClose={() => setLightbox({ open: false, url: null })} />
            )}
            <footer className="mt-6 flex flex-col gap-3 border-t border-cyan-800 pt-4 text-sm text-cyan-200 sm:mt-8 sm:flex-row sm:justify-between">
              <div>
                {session && session.user ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35"
                        onClick={() => setReactionPickerPostId((current) => (current === post.id ? null : post.id))}
                      >
                        <Heart className="h-4 w-4" />
                        <span>{postInteraction.viewerReaction ? `Reacted ${postInteraction.viewerReaction}` : "Like / React"}</span>
                      </button>
                      {reactionPickerPostId === post.id ? (
                        <div className="absolute left-0 top-full z-20 mt-2 flex max-w-[calc(100vw-4rem)] flex-row flex-wrap gap-2 rounded-2xl border border-cyan-300/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl sm:left-full sm:top-0 sm:ml-2 sm:mt-0 sm:max-w-none">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              className={`rounded-full px-3 py-2 text-lg transition hover:scale-110 ${postInteraction.viewerReaction === emoji ? "bg-cyan-400/20" : "bg-black/30"}`}
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                await handleReactionSelect(post.id, emoji);
                                setReactionPickerPostId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35"
                      onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
                    >
                      <MessageCircle className="h-4 w-4" />
                      <span>{isCommentsOpen ? "Hide Comments" : `Comments (${post.comments_count})`}</span>
                    </button>
                    <span>❤️ {post.likes} reactions</span>
                  </div>
                ) : (
                  <span className="italic text-cyan-400">Sign in to like or comment</span>
                )}
              </div>
              <div className="flex gap-4 justify-center sm:justify-end">
                <a href="/terms" className="underline hover:text-green-300">Terms</a>
                <a href="/privacy" className="underline hover:text-green-300">Privacy</a>
                <a href="/guidelines" className="underline hover:text-green-300">Guidelines</a>
                <a href="/suggestions" className="underline hover:text-green-300">Support</a>
              </div>
            </footer>
            {postInteraction.reactions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {postInteraction.reactions.map((reaction) => (
                  <button
                    key={`${post.id}-${reaction.emoji}`}
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                      reaction.reacted
                        ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-50"
                        : "border-cyan-300/20 bg-black/20 text-cyan-100/85"
                    }`}
                    onClick={() => void handleReactionSelect(post.id, reaction.emoji)}
                    disabled={isBusy || !session?.user}
                  >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                ))}
              </div>
            )}
            {isCommentsOpen && (
              <div className="mt-5 rounded-[1.5rem] border border-cyan-300/15 bg-black/20 p-4 backdrop-blur-xl sm:p-5">
                <div className="space-y-4">
                  {postInteraction.comments.length === 0 ? (
                    <p className="text-sm text-cyan-100/65">No comments yet. Start the conversation.</p>
                  ) : (
                    postInteraction.comments.map((comment) => (
                      <div key={comment.id} className="rounded-2xl border border-cyan-300/10 bg-slate-950/55 p-4">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 overflow-hidden rounded-full border border-cyan-300/25 bg-slate-900">
                            {comment.author.avatar_url ? (
                              <img src={comment.author.avatar_url} alt="Comment author" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">TD</div>
                            )}
                          </div>
                          <div
                            className={`min-w-0 flex-1 ${fontClass(comment.author.theme_settings?.font_style)}`}
                            ref={(element) => applyPostThemeVars(element, comment.author.theme_settings)}
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-semibold text-[color:var(--post-text)]">{comment.author.display_name || comment.author.username || "DyeSpace User"}</span>
                              <span className="text-xs text-[color:var(--post-highlight)]/80">@{comment.author.username || "user"}</span>
                              <span className="text-xs text-[color:var(--post-text)]/45">{new Date(comment.created_at).toLocaleString()}</span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-[color:var(--post-text)]/90">{comment.content}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {session?.user ? (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <textarea
                      className="min-h-24 flex-1 rounded-2xl border border-cyan-300/20 bg-slate-950/75 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
                      placeholder="Add a comment"
                      value={commentDrafts[post.id] || ""}
                      onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                    />
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
                      type="button"
                      onClick={() => void handleCommentSubmit(post.id)}
                      disabled={isBusy || !(commentDrafts[post.id] || "").trim()}
                    >
                      <Send className="h-4 w-4" />
                      <span>{isBusy ? "Posting..." : "Post Comment"}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </article>
          );
        })}
      </div>

      {/* Load more cosmic posts button removed as requested */}
    </div>
  );
}
