
"use client";
import Image from "next/image";

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
  author_blessed_until?: string | null;
  author_voided_until?: string | null;
};

type InteractionMap = Record<string, AggregatedPostInteraction>;

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings?: ProfileAppearance | null;
  voided_until?: string | null;
  blessed_until?: string | null;
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

type FeedCategory = "all" | "following" | "tutorial" | "new_boot_goofin" | "for_sale" | "sold_unavailable";

function parsePostCategory(content: string | null): FeedCategory {
  const text = (content || "").toLowerCase();
  if (text.startsWith("[sold]") || text.startsWith("[unavailable]")) return "sold_unavailable";
  if (text.startsWith("[tutorial]")) return "tutorial";
  if (text.startsWith("[new_boot_goofin]")) return "new_boot_goofin";
  return "all";
}

function stripCategoryTag(content: string | null) {
  if (!content) return "";
  return content.replace(/^\[(tutorial|new_boot_goofin|sold|unavailable)\]\s*/i, "").trim();
}

function getCategoryMeta(content: string | null): { value: FeedCategory; label: string } | null {
  const category = parsePostCategory(content);
  if (category === "tutorial") return { value: "tutorial", label: "Tutorial" };
  if (category === "new_boot_goofin") return { value: "new_boot_goofin", label: "New Boot Goofin" };
  if (category === "sold_unavailable") {
    const text = (content || "").toLowerCase();
    return { value: "sold_unavailable", label: text.startsWith("[sold]") ? "Sold" : "No Longer Available" };
  }
  return null;
}

async function fetchPosts({ pageParam }: { pageParam?: string | null }) {
  const url = `/api/posts/feed${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`;
  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "Failed to load posts.");
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Failed to parse posts response.");
  }

  return (body.posts || []) as Post[];
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
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);

  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(new Set());
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostContent, setEditPostContent] = useState("");
  const [editedPostContent, setEditedPostContent] = useState<Record<string, string>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentContent, setEditCommentContent] = useState("");

  // Supabase session detection
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadUserRole = useCallback(async (userId: string) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      if (!error && data?.role === "admin") {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    } catch {
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) {
        void loadUserRole(data.session.user.id);
      } else {
        setIsAdmin(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setIsAdmin(false);
        return;
      }

      if (nextSession) {
        setSession(nextSession);
        if (nextSession.user?.id) {
          void loadUserRole(nextSession.user.id);
        }
      }
    });
    return () => { listener?.subscription.unsubscribe(); };
  }, [loadUserRole]);

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

  const visiblePosts = useMemo(
    () => mergedPosts.filter((post) =>
      isAdmin || !post.author_voided_until || new Date(post.author_voided_until) <= new Date()
    ),
    [isAdmin, mergedPosts]
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
      setInteractionStatus(null);
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
        setInteractionStatus("Could not save your reaction. Please try again.");
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
      setInteractionStatus(null);
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
        setInteractionStatus("Could not post your comment. Please try again.");
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [commentDrafts, session?.user, setPostCounts]
  );

  const handleDeletePost = useCallback(async (postId: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    const res = await fetch(`/api/posts/manage?postId=${postId}`, { method: "DELETE" });
    if (res.ok) {
      setDeletedPostIds((prev) => new Set([...prev, postId]));
    } else {
      setInteractionStatus("Could not delete post. Please try again.");
    }
  }, []);

  const handleSavePostEdit = useCallback(async (postId: string) => {
    const content = editPostContent.trim();
    if (!content) return;
    const res = await fetch("/api/posts/manage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, content }),
    });
    if (res.ok) {
      const body = await res.json();
      setEditedPostContent((prev) => ({ ...prev, [postId]: body.content }));
      setEditingPostId(null);
    } else {
      setInteractionStatus("Could not update post. Please try again.");
    }
  }, [editPostContent]);

  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/posts/comments?commentId=${commentId}&postId=${postId}`, { method: "DELETE" });
    if (res.ok) {
      const body = await res.json();
      setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
      setPostCounts(postId, { comments_count: body.commentsCount ?? 0 });
    } else {
      setInteractionStatus("Could not delete comment. Please try again.");
    }
  }, [setPostCounts]);

  const handleAdminAction = useCallback(
    async (targetUserId: string, action: "mute" | "cosmic_timeout" | "send_to_void" | "cosmic_blessing", durationHours?: number) => {
      if (!session?.user) {
        setAdminActionStatus("Please sign in as an admin to perform this action.");
        return;
      }

      setAdminActionStatus(null);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUserId, action, durationHours }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || "Admin action failed.");
        }

        setAdminActionStatus(body?.message || "Admin action applied successfully.");
      } catch (error: any) {
        setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
      }
    },
    [session?.user]
  );

  const handleSaveCommentEdit = useCallback(async (commentId: string, postId: string) => {
    const content = editCommentContent.trim();
    if (!content) return;
    const res = await fetch("/api/posts/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, postId, content }),
    });
    if (res.ok) {
      const body = await res.json();
      setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
      setEditingCommentId(null);
    } else {
      setInteractionStatus("Could not update comment. Please try again.");
    }
  }, [editCommentContent]);

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

      {interactionStatus ? (
        <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">
          {interactionStatus}
        </div>
      ) : null}
      {adminActionStatus ? (
        <div className="mb-4 rounded-xl border border-violet-300/30 bg-violet-500/15 px-4 py-2 text-sm text-violet-100">
          {adminActionStatus}
        </div>
      ) : null}

      {isLoading && <div className="text-teal-200">Loading cosmic posts...</div>}
      {error && <div className="text-red-300">Error loading posts: {(error as Error).message}</div>}

      <div className="grid grid-cols-1 gap-6">
        {visiblePosts.filter((post) => !deletedPostIds.has(post.id)).map((post) => {
          const postInteraction = interactions[post.id] || { comments: [], reactions: [], viewerReaction: null };
          const isCommentsOpen = Boolean(expandedComments[post.id]);
          const isBusy = interactionBusyPostId === post.id;
          const isOwner = !!session?.user && session.user.id === post.user_id;
          const displayContent = editedPostContent[post.id] ?? post.content;
          const categoryMeta = getCategoryMeta(displayContent);
          const visibleContent = stripCategoryTag(displayContent);

          return (
          <article
            key={post.id}
            className={`bg-gradient-to-br from-teal-900/40 via-blue-950/40 to-emerald-900/40 border fractal-border rounded-[1.5rem] p-5 transition hover:-translate-y-1 hover:shadow-2xl sm:rounded-3xl sm:p-6 ${fontClass(post.author_theme?.font_style)}`}
            ref={(element) => applyPostThemeVars(element, post.author_theme)}
          >
            <header className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={post.author_username ? `/profile/${post.author_username}` : '#'}
                    className="font-bold text-[color:var(--post-text)] hover:text-[color:var(--post-highlight)] hover:underline"
                    prefetch={false}
                  >
                    {post.author_display_name || "DyeSpace User"}
                  </Link>
                  <Link
                    href={post.author_username ? `/profile/${post.author_username}` : '#'}
                    className="text-xs text-[color:var(--post-highlight)]/85 hover:text-[color:var(--post-highlight)] hover:underline"
                    prefetch={false}
                  >
                    @{post.author_username || "dyespace-user"}
                  </Link>
                  {post.author_blessed_until && new Date(post.author_blessed_until) > new Date() ? (
                    <span className="inline-flex rounded-full border border-fuchsia-300/45 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-100">
                      Cosmic Blessing
                    </span>
                  ) : null}
                  {categoryMeta ? (
                    <Link
                      href={`/explore?tab=${encodeURIComponent(categoryMeta.value)}`}
                      className="inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-300/30"
                    >
                      {categoryMeta.label}
                    </Link>
                  ) : null}
                </div>
                <time className="block text-xs text-[color:var(--post-text)]/70">{new Date(post.created_at).toLocaleString()}</time>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-green-900/30 px-2 py-1 text-xs text-green-200">{post.is_for_sale ? "For Sale" : "Just Shared"}</span>
                {(isOwner || isAdmin) && (
                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <button
                        type="button"
                        className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-900/30 transition"
                        onClick={() => { setEditingPostId(post.id); setEditPostContent(displayContent ?? ""); }}
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-full border border-rose-300/25 bg-black/20 px-3 py-1 text-xs text-rose-300 hover:bg-rose-900/30 transition"
                      onClick={() => void handleDeletePost(post.id)}
                    >
                      Delete
                    </button>
                    {isAdmin && session?.user?.id !== post.user_id ? (
                      <details className="relative">
                        <summary className="rounded-full border border-violet-300/25 bg-black/20 px-3 py-1 text-xs text-violet-200 hover:bg-violet-900/30 transition cursor-pointer">
                          Admin
                        </summary>
                        <div className="absolute right-0 z-10 mt-2 w-56 rounded-2xl border border-violet-300/20 bg-slate-950/95 p-3 shadow-[0_20px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                          <button
                            type="button"
                            className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "mute", 4)}
                          >
                            Mute 4h
                          </button>
                          <button
                            type="button"
                            className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "mute", 8)}
                          >
                            Mute 8h
                          </button>
                          <button
                            type="button"
                            className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "mute", 12)}
                          >
                            Mute 12h
                          </button>
                          <button
                            type="button"
                            className="mb-2 w-full rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-left text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "cosmic_timeout", 4)}
                          >
                            Cosmic Timeout 4h
                          </button>
                          <button
                            type="button"
                            className="mb-2 w-full rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-left text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "send_to_void")}
                          >
                            Send to the Void (24h)
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-left text-xs font-semibold text-amber-100 hover:bg-amber-500/15"
                            onClick={() => void handleAdminAction(post.user_id, "cosmic_blessing")}
                          >
                            Cosmic Blessing
                          </button>
                        </div>
                      </details>
                    ) : null}
                  </div>
                )}
              </div>
            </header>
            <div className="block w-full text-left space-y-4">
              <button
                type="button"
                className="block w-full text-left hover:opacity-80 transition"
                onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
              >
                {editingPostId === post.id ? null : (
                  <p className="mb-3 text-sm leading-7 text-[color:var(--post-text)]/92 sm:text-base sm:leading-8">{visibleContent || "No description provided yet."}</p>
                )}
              </button>
              {editingPostId === post.id && (
                <div className="mb-3 flex flex-col gap-2">
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-cyan-300/20 bg-slate-950/75 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
                    title="Edit post content"
                    placeholder="Edit your post"
                    value={editPostContent}
                    onChange={(e) => setEditPostContent(e.target.value)}
                    maxLength={2000}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-gradient-to-r from-cyan-300 to-teal-300 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:opacity-90 transition"
                      onClick={() => void handleSavePostEdit(post.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/25 bg-black/20 px-4 py-1.5 text-xs text-cyan-300 hover:bg-cyan-900/30 transition"
                      onClick={() => setEditingPostId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {post.image_urls && post.image_urls.length > 0 && (
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  {post.image_urls.map((imgUrl, idx) => (
                    <button key={idx} type="button" className="group relative w-full overflow-hidden rounded-2xl cursor-zoom-in" onClick={() => {
                      setLightbox({ open: true, url: imgUrl });
                    }}>
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900 sm:aspect-[16/9]">
                        <Image
                          src={imgUrl}
                          alt={`Post image ${idx + 1}`}
                          className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-105"
                          loading="lazy"
                          tabIndex={0}
                          fill
                          unoptimized
                        />
                      </div>
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
                        <div className="absolute right-0 top-full z-20 mt-2 flex max-w-[calc(100vw-3rem)] flex-row flex-wrap gap-2 rounded-2xl border border-cyan-300/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl sm:left-full sm:right-auto sm:top-0 sm:ml-2 sm:mt-0 sm:max-w-none">
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
                <Link href="/terms" className="underline hover:text-green-300">Terms</Link>
                <Link href="/privacy" className="underline hover:text-green-300">Privacy</Link>
                <Link href="/guidelines" className="underline hover:text-green-300">Guidelines</Link>
                <Link href="/suggestions" className="underline hover:text-green-300">Support</Link>
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
                              <Image src={comment.author.avatar_url} alt="Comment author" className="h-full w-full object-cover" loading="lazy" width={40} height={40} unoptimized />
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
                            {isAdmin && session?.user?.id !== comment.author.id ? (
                              <details className="mt-2 relative">
                                <summary className="inline-flex cursor-pointer rounded-full border border-violet-300/25 bg-black/20 px-2 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-900/30 transition">
                                  Admin Tools
                                </summary>
                                <div className="absolute right-0 z-10 mt-2 w-56 rounded-2xl border border-violet-300/20 bg-slate-950/95 p-3 shadow-[0_20px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                                  <button
                                    type="button"
                                    className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "mute", 4)}
                                  >
                                    Mute 4h
                                  </button>
                                  <button
                                    type="button"
                                    className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "mute", 8)}
                                  >
                                    Mute 8h
                                  </button>
                                  <button
                                    type="button"
                                    className="mb-2 w-full rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-left text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "mute", 12)}
                                  >
                                    Mute 12h
                                  </button>
                                  <button
                                    type="button"
                                    className="mb-2 w-full rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-left text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "cosmic_timeout", 4)}
                                  >
                                    Cosmic Timeout 4h
                                  </button>
                                  <button
                                    type="button"
                                    className="mb-2 w-full rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-left text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "send_to_void")}
                                  >
                                    Send to the Void
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-left text-xs font-semibold text-amber-100 hover:bg-amber-500/15"
                                    onClick={() => void handleAdminAction(comment.author.id, "cosmic_blessing")}
                                  >
                                    Cosmic Blessing
                                  </button>
                                </div>
                              </details>
                            ) : null}
                              {editingCommentId === comment.id ? (
                                <div className="mt-2 flex flex-col gap-2">
                                  <textarea
                                    className="min-h-16 w-full rounded-xl border border-cyan-300/20 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                                    title="Edit your comment"
                                    placeholder="Edit your comment"
                                    value={editCommentContent}
                                    onChange={(e) => setEditCommentContent(e.target.value)}
                                    maxLength={1000}
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      className="rounded-full bg-cyan-500/80 px-3 py-1 text-xs text-white hover:bg-cyan-400 transition"
                                      onClick={() => void handleSaveCommentEdit(comment.id, post.id)}
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-cyan-300/20 bg-black/20 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-900/30 transition"
                                      onClick={() => setEditingCommentId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="mt-2 whitespace-pre-wrap text-[color:var(--post-text)]/90">{comment.content}</p>
                              )}
                              {(session?.user?.id === comment.author.id || isAdmin) && editingCommentId !== comment.id && (
                                <div className="mt-2 flex gap-3">
                                  {session?.user?.id === comment.author.id ? (
                                    <button
                                      type="button"
                                      className="text-xs text-cyan-400 hover:underline transition"
                                      onClick={() => { setEditingCommentId(comment.id); setEditCommentContent(comment.content); }}
                                    >
                                      Edit
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="text-xs text-rose-400 hover:underline transition"
                                    onClick={() => void handleDeleteComment(comment.id, post.id)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
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
