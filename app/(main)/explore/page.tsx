
"use client";
import Image from "next/image";

import dynamic from "next/dynamic";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import AdminActionMenu from "@/app/AdminActionMenu";
import Link from "next/link";
import { fontClass, resolveProfileAppearance, type ProfileAppearance } from "@/lib/profile-theme";
import { normalizePostImageUrls } from "@/lib/post-media";
import AsyncStateCard from "@/app/AsyncStateCard";
import CustomEmojiImage from "@/app/CustomEmojiImage";
import InlineEmojiText from "@/app/InlineEmojiText";
import UserIdentity from "@/app/UserIdentity";
import { runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { Home, Users, BookOpen, PartyPopper, Tag, Ban } from "lucide-react";
import { Heart, MessageCircle, Send } from "lucide-react";
import EmojiPicker from "@/app/EmojiPicker";
import { appendEmojiToText, buildCustomEmojiAsset } from "@/lib/custom-emojis";
import { countInteractionReactions, type AggregatedPostInteraction, type ReactionEmoji } from "@/lib/post-interactions";

type ExplorePost = {
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
  author_verified_badge?: boolean;
  author_member_number?: number | null;
};

type InteractionMap = Record<string, AggregatedPostInteraction>;

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings?: ProfileAppearance | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
};

function isShadowBanned(profile?: ProfileRow) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

type FeedCategory = "all" | "following" | "tutorial" | "new_boot_goofin" | "for_sale" | "sold_unavailable";

const TABS: Array<{ label: string; value: FeedCategory; icon: React.ReactNode }> = [
  { label: "All Posts", value: "all", icon: <Home size={18} /> },
  { label: "Following", value: "following", icon: <Users size={18} /> },
  { label: "Tutorials", value: "tutorial", icon: <BookOpen size={18} /> },
  { label: "New Boot Goofin", value: "new_boot_goofin", icon: <PartyPopper size={18} /> },
  { label: "For Sale", value: "for_sale", icon: <Tag size={18} /> },
  { label: "Sold / No Longer Available", value: "sold_unavailable", icon: <Ban size={18} /> },
];

function parsePostCategory(content: string | null): FeedCategory {
  const text = (content || "").toLowerCase();
  if (text.startsWith("[sold]") || text.startsWith("[unavailable]")) return "sold_unavailable";
  if (text.startsWith("[tutorial]")) return "tutorial";
  if (text.startsWith("[new_boot_goofin]")) return "new_boot_goofin";
  return "all";
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

function stripCategoryTag(content: string | null): string {
  if (!content) return "";
  return content.replace(/^\[(tutorial|new_boot_goofin|sold|unavailable)\]\s*/i, "").trim();
}

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

function applyPostThemeVars(element: HTMLElement | null, appearance?: ProfileAppearance | null) {
  if (!element) return;
  const resolved = resolveProfileAppearance(appearance);
  element.style.setProperty("--post-text", resolved.text_color);
  element.style.setProperty("--post-highlight", resolved.highlight_color);
  // Set post background color with opacity
  const bg = resolved.background_color;
  const opacity = typeof resolved.background_opacity === "number" ? resolved.background_opacity : 0.7;
  // Convert hex to rgba
  function hexToRgba(hex: string, alpha: number) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const num = parseInt(c, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  element.style.setProperty("--post-bg", hexToRgba(bg, opacity));
}

function ReportPostButton({ postId }: { postId: string }) {
  const handleReport = useCallback(async () => {
    const reason = prompt("Reason for reporting this post?");
    if (!reason) return;
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const reporterId = sessionData?.session?.user?.id || null;
    await supabase.from("reports").insert({
      type: "post",
      reported_id: postId,
      reporter_id: reporterId,
      reported_by: reporterId,
      reason,
      created_at: new Date().toISOString(),
    });
    alert("Post reported. Thank you!");
  }, [postId]);
  return (
    <button
      className="rounded-full border border-pink-400/60 bg-pink-900/40 px-3 py-1 text-xs font-semibold text-pink-200 hover:bg-pink-900/80 hover:text-white transition"
      onClick={handleReport}
      title="Report post"
    >
      Report
    </button>
  );
}

export default function ExplorePage() {
  const LightboxModal = dynamic(() => import("../../LightboxModal"), { ssr: false });
  const [lightbox, setLightbox] = useState<{ open: boolean; images: string[]; index: number }>({ open: false, images: [], index: 0 });
  const [tab, setTab] = useState<FeedCategory>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [marketplaceOnly, setMarketplaceOnly] = useState(false);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [interactions, setInteractions] = useState<InteractionMap>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [interactionBusyPostId, setInteractionBusyPostId] = useState<string | null>(null);
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (!requestedTab) return;

    const allowedTabs: FeedCategory[] = ["all", "following", "tutorial", "new_boot_goofin", "for_sale", "sold_unavailable"];
    if (allowedTabs.includes(requestedTab as FeedCategory)) {
      setTab(requestedTab as FeedCategory);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const nextUserId = data.session?.user?.id || null;
      setSessionUserId(nextUserId);
      if (nextUserId) {
        supabase
          .from("profiles")
          .select("role")
          .eq("id", nextUserId)
          .maybeSingle()
          .then(({ data: profile }) => {
            setViewerIsAdmin(profile?.role === "admin");
          });
      } else {
        setViewerIsAdmin(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSessionUserId(null);
        setViewerIsAdmin(false);
        return;
      }

      if (nextSession?.user?.id) {
        setSessionUserId(nextSession.user.id);
        supabase
          .from("profiles")
          .select("role")
          .eq("id", nextSession.user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            setViewerIsAdmin(profile?.role === "admin");
          });
      }
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadPosts = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        let followingIds: string[] = [];

        if (tab === "following") {
          const followingRes = await fetch("/api/profile/following", { cache: "no-store" });
          const followingBody = await followingRes.json().catch(() => ({}));
          if (!followingRes.ok) {
            throw new Error(followingBody?.error || "Failed to load Following feed.");
          }

          followingIds = Array.isArray(followingBody?.followingIds)
            ? followingBody.followingIds.filter((id: unknown): id is string => typeof id === "string")
            : [];

          if (!followingIds.length) {
            if (!active) return;
            setPosts([]);
            setLoading(false);
            return;
          }
        }

        let query = supabase
          .from("posts")
          .select("id,user_id,content,image_urls,likes,comments_count,is_for_sale,created_at")
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (tab === "following") {
          query = query.in("user_id", followingIds);
        }

        if (search.trim()) {
          query = query.ilike("content", `%${search.trim()}%`);
        }

        const { data, error: fetchError } = await query;
        if (fetchError) throw fetchError;

        if (!active) return;
        const rows = ((data || []) as ExplorePost[]).map((post) => {
          const imageUrls = normalizePostImageUrls(post.image_urls);
          return {
            ...post,
            image_urls: imageUrls.length ? imageUrls : null,
          };
        });

        const userIds = [...new Set(rows.map((post) => post.user_id).filter(Boolean))];
        const profilesById = new Map<string, ProfileRow>();

        if (userIds.length) {
          const { data: profilesData, error: profilesError } = await supabase
            .from("profiles")
            .select("id,username,display_name,theme_settings,verified_badge,member_number,shadow_banned,shadow_banned_until")
            .in("id", userIds);

          if (profilesError) {
            // Suppress noisy profile loading error
          } else {
            (profilesData || []).forEach((profile) => {
              profilesById.set(profile.id, profile as ProfileRow);
            });
          }
        }

        const withAuthorNames = rows.map((post) => {
          const profile = profilesById.get(post.user_id);
          return {
            ...post,
            author_display_name: formatDisplayName(profile),
            author_at_name: formatAtName(profile),
            author_username: profile?.username ?? null,
            author_theme: profile?.theme_settings ?? null,
            author_verified_badge: profile?.verified_badge === true,
            author_member_number: profile?.member_number ?? null,
          };
        });

        const filtered = withAuthorNames.filter((post) => {
          const author = profilesById.get(post.user_id);
          if (!viewerIsAdmin && post.user_id !== sessionUserId && isShadowBanned(author)) return false;
          if (marketplaceOnly && !post.is_for_sale) return false;
          if (tab === "following") return true;
          if (tab === "all") return true;
          if (tab === "for_sale") return post.is_for_sale;
          if (tab === "sold_unavailable") return !post.is_for_sale && parsePostCategory(post.content) === "sold_unavailable";
          return parsePostCategory(post.content) === tab;
        });
        setPosts(filtered);
      } catch (e: any) {
        if (!active) return;
        setError(typeof e?.message === "string" ? e.message : "Failed to load posts.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPosts();
    return () => {
      active = false;
    };
  }, [marketplaceOnly, reloadKey, search, sessionUserId, tab, viewerIsAdmin]);

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

  const updatePostCounters = useCallback((postId: string, updates: Partial<Pick<ExplorePost, "likes" | "comments_count">>) => {
    setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, ...updates } : post)));
  }, []);

  const handleReactionSelect = useCallback(
    async (postId: string, emoji: ReactionEmoji) => {
      if (!sessionUserId) {
        setInteractionStatus("Please sign in to react to posts.");
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
        updatePostCounters(postId, { likes: body.likesCount ?? 0 });
      } catch (error: any) {
        setInteractionStatus(typeof error?.message === "string" ? error.message : "Failed to save reaction.");
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [sessionUserId, updatePostCounters]
  );

  const handleCommentReactionSelect = useCallback(
    async (postId: string, commentId: string, emoji: ReactionEmoji) => {
      if (!sessionUserId) {
        setInteractionStatus("Please sign in to react to comments.");
        return;
      }

      setInteractionBusyPostId(postId);
      setInteractionStatus(null);
      try {
        const response = await fetch("/api/posts/comment-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, commentId, emoji }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Failed to save comment reaction.");
        }

        setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
      } catch (error: any) {
        setInteractionStatus(typeof error?.message === "string" ? error.message : "Failed to save comment reaction.");
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [sessionUserId]
  );

  const handleCommentSubmit = useCallback(
    async (postId: string) => {
      if (!sessionUserId) {
        setInteractionStatus("Please sign in to comment on posts.");
        return;
      }

      const content = commentDrafts[postId]?.trim();
      if (!content) return;

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
        updatePostCounters(postId, { comments_count: body.commentsCount ?? 0 });
        setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
        setExpandedComments((prev) => ({ ...prev, [postId]: true }));
      } catch (error: any) {
        setInteractionStatus(typeof error?.message === "string" ? error.message : "Failed to save comment.");
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [commentDrafts, sessionUserId, updatePostCounters]
  );

  const handleAdminAction = useCallback(async (targetUserId: string, action: AdminActionName, durationHours?: number) => {
    setAdminActionStatus(null);
    try {
      const body = await runAdminUserAction({ targetUserId, action, durationHours });
      setAdminActionStatus(body?.message || "Admin action applied successfully.");
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
    }
  }, []);

  const title = useMemo(() => {
    if (tab === "following") return "Following Feed";
    if (tab === "tutorial") return "Tutorial Posts";
    if (tab === "new_boot_goofin") return "New Boot Goofin";
    if (tab === "for_sale") return "For Sale";
    if (tab === "sold_unavailable") return "Sold / No Longer Available";
    return "Community Feed";
  }, [tab]);

  const markListingStatus = async (post: ExplorePost, nextStatus: "sold" | "unavailable") => {
    try {
      const res = await fetch("/api/posts/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, status: nextStatus }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update listing status.");
      }

      setPosts((prev) => prev.filter((item) => item.id !== post.id));
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : "Failed to update listing status.");
    }
  };

  return (
    <div className="relative min-h-screen px-3 pb-10 pt-6 sm:px-8 sm:pb-16 sm:pt-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap gap-3">
          {TABS.map((t) => (
            <button
              key={t.value}
              className={`group relative rounded-full border p-0 w-11 h-11 flex items-center justify-center transition-all duration-200
                ${tab === t.value
                  ? "border-cyan-200/60 bg-cyan-300 text-slate-950"
                  : "border-cyan-300/25 bg-black/35 text-cyan-100 hover:bg-black/55"}
              `}
              onClick={() => setTab(t.value)}
              aria-label={t.label}
              title={t.label}
            >
              {t.icon}
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-cyan-200/35 bg-slate-950/95 px-2 py-1 text-[11px] font-medium text-cyan-100 opacity-0 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                {t.label}
              </span>
            </button>
          ))}
          <Link
            href="/chat"
            className="rounded-full border-4 border-red-600 bg-gradient-to-br from-red-700 via-red-500 to-red-700 px-8 py-4 text-2xl font-extrabold text-white shadow-lg hover:scale-105 hover:bg-red-700/90 transition-all ml-auto"
            style={{ boxShadow: "0 0 32px 4px rgba(239,68,68,0.25)" }}
          >
            The Dye Chat
          </Link>
        </div>

        <div className="mb-8">
          <input
            className="w-full rounded-2xl border border-cyan-300/25 bg-black/35 px-5 py-3 text-cyan-50 outline-none transition focus:border-cyan-200/55"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-cyan-100/90">
            <input
              type="checkbox"
              checked={marketplaceOnly}
              onChange={(event) => setMarketplaceOnly(event.target.checked)}
              className="h-4 w-4 rounded border-cyan-200/40 bg-black/40"
            />
            Marketplace only (For Sale)
          </label>
        </div>

        <h2 className="mb-4 text-2xl font-semibold text-cyan-50">{title}</h2>

        {loading ? (
          <AsyncStateCard
            compact
            loading
            title="Loading explore posts"
            message={tab === "following" ? "Pulling together posts from the people you follow." : "Collecting fresh posts for explore."}
            className="mb-4"
          />
        ) : null}
        {error ? (
          <AsyncStateCard
            compact
            tone="error"
            title="Couldn\'t load explore"
            message={error}
            actionLabel="Retry explore"
            onAction={() => setReloadKey((current) => current + 1)}
            className="mb-4"
          />
        ) : null}
        {interactionStatus ? <p className="mb-4 text-sm text-rose-200">{interactionStatus}</p> : null}
        {adminActionStatus ? <p className="mb-4 text-sm text-cyan-100">{adminActionStatus}</p> : null}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100/75">
            {tab === "following"
              ? "No posts in Following yet. Follow artists to build your feed."
              : "No posts yet. The feed will populate when users publish posts."}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => {
            const postInteraction = interactions[post.id] || { comments: [], reactions: [], viewerReaction: null };
            const isCommentsOpen = Boolean(expandedComments[post.id]);
            const isBusy = interactionBusyPostId === post.id;
            const selectedPostReaction = postInteraction.viewerReaction ? buildCustomEmojiAsset(postInteraction.viewerReaction) : null;
            const totalPostReactions = countInteractionReactions(postInteraction);

            return (
            <article
              key={post.id}
              className={`rounded-3xl border-4 border-gradient-tiedye bg-[var(--post-bg,rgba(7,17,31,0.7))] p-4 shadow-[0_0_0_4px_rgba(0,0,0,0.18),0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-5 ${fontClass(post.author_theme?.font_style)}`}
              ref={(element) => applyPostThemeVars(element, post.author_theme)}
            >
              {post.image_urls?.[0] ? (
                  <button type="button" className="group relative mb-4 block aspect-[4/5] w-full overflow-hidden rounded-2xl sm:aspect-[4/3]" onClick={() => setLightbox({ open: true, images: post.image_urls || [], index: 0 })}>
                    <Image src={post.image_urls[0]} alt="Post" className="h-full w-full rounded-2xl object-cover transition duration-200 group-hover:scale-105" loading="lazy" fill unoptimized />
                    {post.image_urls.length > 1 ? (
                      <span className="absolute right-3 top-3 rounded-full border border-black/15 bg-black/55 px-2 py-1 text-[11px] font-semibold text-cyan-50 shadow-lg backdrop-blur-sm">
                        {post.image_urls.length} photos
                      </span>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-3 py-4 text-left text-xs text-cyan-50/85 sm:text-sm">Tap to expand</div>
                  </button>
              ) : null}
                <InlineEmojiText
                  text={stripCategoryTag(post.content) || "No description provided."}
                  className="mb-3 block whitespace-pre-wrap text-sm leading-6 text-[color:var(--post-text)]/92 sm:text-base sm:leading-7"
                />
              <div className="mb-3">
                <UserIdentity
                  displayName={post.author_display_name || "DyeSpace User"}
                  username={post.author_username || null}
                  verifiedBadge={post.author_verified_badge === true}
                  memberNumber={post.author_member_number ?? null}
                  className="min-w-0"
                  nameClassName="text-sm font-semibold text-[color:var(--post-text)] hover:text-[color:var(--post-highlight)] hover:underline"
                  usernameClassName="text-xs text-[color:var(--post-highlight)]/85 hover:text-[color:var(--post-highlight)] hover:underline"
                  metaClassName="text-xs text-[color:var(--post-text)]/55"
                />
                {getCategoryMeta(post.content) ? (
                  <Link
                    href={`/explore?tab=${encodeURIComponent(getCategoryMeta(post.content)!.value)}`}
                    className="ml-2 inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-300/30"
                  >
                    {getCategoryMeta(post.content)!.label}
                  </Link>
                ) : null}
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {post.is_for_sale ? (
                  <span className="rounded-full border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100">
                    For Sale
                  </span>
                ) : null}
                {parsePostCategory(post.content) === "sold_unavailable" ? (
                  <span className="rounded-full border border-amber-300/40 bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-100">
                    {post.content?.toLowerCase().startsWith("[sold]") ? "Sold" : "No Longer Available"}
                  </span>
                ) : null}
              </div>

              {post.is_for_sale && sessionUserId && post.user_id === sessionUserId ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-emerald-300/50 bg-emerald-500/25 px-3 py-1 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/35"
                    onClick={() => markListingStatus(post, "sold")}
                  >
                    Mark as Sold
                  </button>
                  <button
                    className="rounded-full border border-amber-300/50 bg-amber-500/25 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-500/35"
                    onClick={() => markListingStatus(post, "unavailable")}
                  >
                    Mark Unavailable
                  </button>
                </div>
              ) : null}

              <div className="flex items-center justify-between text-xs text-[color:var(--post-text)]/75 mb-2">
                <span>{new Date(post.created_at).toLocaleString()}</span>
                <span>{totalPostReactions} reactions • {post.comments_count} comments</span>
              </div>
              {sessionUserId ? (
                <div className="flex flex-wrap items-center gap-3">
                  <EmojiPicker
                    mode="reaction"
                    align="left"
                    disabled={isBusy}
                    triggerClassName="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60"
                    triggerContent={
                      <>
                        {selectedPostReaction ? (
                          <CustomEmojiImage src={selectedPostReaction.url} alt={selectedPostReaction.name} className="h-4 w-4 object-contain" title={selectedPostReaction.name} />
                        ) : (
                          <Heart className="h-4 w-4" />
                        )}
                        <span>{selectedPostReaction ? "Change Reaction" : "React"}</span>
                      </>
                    }
                    onSelect={(emoji) => {
                      void handleReactionSelect(post.id, emoji);
                    }}
                  />
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35"
                    onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span>{isCommentsOpen ? "Hide Comments" : "Comments"}</span>
                  </button>
                  <ReportPostButton postId={post.id} />
                  {viewerIsAdmin && sessionUserId !== post.user_id ? <AdminActionMenu targetUserId={post.user_id} onAction={handleAdminAction} /> : null}
                </div>
              ) : (
                <p className="text-sm italic text-cyan-300/80">Sign in to interact with posts.</p>
              )}

              {postInteraction.reactions.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {postInteraction.reactions.map((reaction) => (
                    <button
                      key={`${post.id}-${reaction.emoji}`}
                      type="button"
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                        reaction.reacted
                          ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-50"
                          : "border-cyan-300/20 bg-black/20 text-cyan-100/85"
                      } ${!sessionUserId ? "cursor-default opacity-80" : "hover:border-cyan-300/40"}`}
                      onClick={() => sessionUserId ? void handleReactionSelect(post.id, reaction.emoji) : undefined}
                      disabled={isBusy || !sessionUserId}
                    >
                      <CustomEmojiImage src={reaction.emoji} alt="post reaction" className="h-5 w-5 object-contain" />
                      <span>{reaction.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {isCommentsOpen ? (
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
                            <div className={`min-w-0 flex-1 ${fontClass(comment.author.theme_settings?.font_style)}`} ref={(element) => applyPostThemeVars(element, comment.author.theme_settings)}>
                              <UserIdentity
                                displayName={comment.author.display_name || "DyeSpace User"}
                                username={comment.author.username}
                                verifiedBadge={comment.author.verified_badge}
                                memberNumber={comment.author.member_number}
                                timestampText={new Date(comment.created_at).toLocaleString()}
                                className="min-w-0"
                                nameClassName="font-semibold text-[color:var(--post-text)] hover:text-[color:var(--post-highlight)] hover:underline"
                                usernameClassName="text-xs text-[color:var(--post-highlight)]/80 hover:text-[color:var(--post-highlight)] hover:underline"
                                metaClassName="text-xs text-[color:var(--post-text)]/45"
                              />
                              <InlineEmojiText text={comment.content} className="mt-2 block whitespace-pre-wrap text-[color:var(--post-text)]/90" />
                              {(comment.reactions.length > 0 || sessionUserId) ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {comment.reactions.map((reaction) => (
                                    <button
                                      key={`${comment.id}-${reaction.emoji}`}
                                      type="button"
                                      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition ${
                                        reaction.reacted
                                          ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-50"
                                          : "border-cyan-300/20 bg-black/20 text-cyan-100/85"
                                      }`}
                                      onClick={() => void handleCommentReactionSelect(post.id, comment.id, reaction.emoji)}
                                      disabled={isBusy || !sessionUserId}
                                    >
                                      <CustomEmojiImage src={reaction.emoji} alt="comment reaction" className="h-4 w-4 object-contain" />
                                      <span>{reaction.count}</span>
                                    </button>
                                  ))}
                                  {sessionUserId ? (
                                    <EmojiPicker
                                      mode="reaction"
                                      align="left"
                                      disabled={isBusy}
                                      triggerClassName="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-3 py-1 text-xs text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60"
                                      triggerContent={
                                        <>
                                          {comment.viewerReaction ? (
                                            <CustomEmojiImage src={comment.viewerReaction} alt="your reaction" className="h-4 w-4 object-contain" />
                                          ) : (
                                            <Heart className="h-3.5 w-3.5" />
                                          )}
                                          <span>{comment.viewerReaction ? "Change Reaction" : "React"}</span>
                                        </>
                                      }
                                      onSelect={(emoji) => {
                                        void handleCommentReactionSelect(post.id, comment.id, emoji);
                                      }}
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {sessionUserId ? (
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                      <textarea
                        className="min-h-24 flex-1 rounded-2xl border border-cyan-300/20 bg-slate-950/75 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
                        placeholder="Add a comment"
                        value={commentDrafts[post.id] || ""}
                        onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                      />
                      <EmojiPicker
                        className="sm:self-end"
                        onSelect={(emojiOrToken) =>
                          setCommentDrafts((prev) => ({
                            ...prev,
                            [post.id]: appendEmojiToText(prev[post.id] || "", emojiOrToken),
                          }))
                        }
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
              ) : null}
            </article>
            );
          })}
        </div>
        {lightbox.open && lightbox.images.length > 0 ? (
          <LightboxModal
            images={lightbox.images}
            initialIndex={lightbox.index}
            onClose={() => setLightbox({ open: false, images: [], index: 0 })}
          />
        ) : null}
      </div>
    </div>
  );
}
