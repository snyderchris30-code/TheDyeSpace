
"use client";
import Image from "next/image";

import dynamic from "next/dynamic";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { dedupeApiFetchJson, dedupeFetchJson } from "@/lib/dedupe-fetch";
import AdminActionMenu from "@/app/AdminActionMenu";
import Link from "next/link";
import { fontClass, resolveProfileAppearance, type ProfileAppearance } from "@/lib/profile-theme";
import { normalizePostImageUrls } from "@/lib/post-media";
import AsyncStateCard from "@/app/AsyncStateCard";
import CustomEmojiImage from "@/app/CustomEmojiImage";
import InlineEmojiText from "@/app/InlineEmojiText";
import PostAffiliateProducts from "@/app/PostAffiliateProducts";
import UserIdentity from "@/app/UserIdentity";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { hasAdminAccess, runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { submitModerationReport } from "@/lib/report-client";
import { Home, Users, BookOpen, PartyPopper, Tag, Ban } from "lucide-react";
import { Heart, MessageCircle, Send } from "lucide-react";
import EmojiPicker from "@/app/EmojiPicker";
import { appendEmojiToText, buildCustomEmojiAsset } from "@/lib/custom-emojis";
import { countInteractionReactions, type AggregatedPostInteraction, type ReactionEmoji } from "@/lib/post-interactions";
import {
  buildPostContentWithAffiliateProducts,
  extractAffiliateProductIds,
  stripAffiliateProductTokens,
} from "@/lib/post-affiliate-products";
import { normalizeSellerProducts } from "@/lib/verified-seller";

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
  is_shop_listing?: boolean;
};

type InteractionMap = Record<string, AggregatedPostInteraction>;

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  created_at?: string | null;
  theme_settings?: ProfileAppearance | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
};

const EMPTY_INTERACTIONS: InteractionMap = Object.freeze({}) as InteractionMap;

const exploreLoadPromises = new Map<string, Promise<void>>();

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

async function fetchExplorePosts({ queryKey }: { queryKey: unknown[] }) {
  const [, tab, search, marketplaceOnly, sessionUserId, viewerIsAdmin] = queryKey as [string, FeedCategory, string, boolean, string | null, boolean];
  const supabase = createClient();
  let followingIds: string[] = [];

  if (tab === "following") {
    const followingBody = await dedupeFetchJson<{ followingIds?: string[] }>(
      "/api/profile/following",
      { cache: "no-store" },
      { cacheTtlMs: 3000 }
    );

    followingIds = Array.isArray(followingBody.followingIds)
      ? followingBody.followingIds.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (!followingIds.length) {
      return [];
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
  if (fetchError) {
    throw fetchError;
  }

  const rows = ((data || []) as ExplorePost[]).map((post) => ({
    ...post,
    is_shop_listing: false,
    image_urls: normalizePostImageUrls(post.image_urls).length ? normalizePostImageUrls(post.image_urls) : null,
  }));

  const userIds = [...new Set(rows.map((post) => post.user_id).filter(Boolean))];
  const profilesById = new Map<string, ProfileRow>();

  if (userIds.length) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id,username,display_name,created_at,theme_settings,verified_badge,member_number,shadow_banned,shadow_banned_until")
      .in("id", userIds);

    if (!profilesError) {
      (profilesData || []).forEach((profile) => {
        profilesById.set(profile.id, profile as ProfileRow);
      });
    }
  }

  let sellerProfilesQuery = supabase
    .from("profiles")
    .select("id,username,display_name,created_at,theme_settings,verified_badge,member_number,shadow_banned,shadow_banned_until")
    .eq("verified_badge", true)
    .limit(200);

  if (tab === "following") {
    sellerProfilesQuery = sellerProfilesQuery.in("id", followingIds);
  }

  const { data: sellerProfilesData } = await sellerProfilesQuery;
  const sellerProfiles = (sellerProfilesData || []) as ProfileRow[];
  sellerProfiles.forEach((profile) => {
    profilesById.set(profile.id, profile);
  });

  const shopListingRows: ExplorePost[] = [];
  for (const profile of sellerProfiles) {
    if (profile.verified_badge !== true) {
      continue;
    }

    const userId = profile.id;

    const normalizedProducts = normalizeSellerProducts(profile.theme_settings?.shop_products);
    for (const [index, product] of normalizedProducts.entries()) {
      const descriptionParts = [product.title?.trim(), product.price ? `$${product.price}` : null, product.description?.trim()]
        .filter(Boolean)
        .map(String);
      const imageUrls = normalizePostImageUrls(product.photo_urls || null);

      shopListingRows.push({
        id: `shop-product-${userId}-${product.id}`,
        user_id: userId,
        content: descriptionParts.join(" • ") || product.title || "Verified Seller Listing",
        image_urls: imageUrls.length ? imageUrls : null,
        likes: 0,
        comments_count: 0,
        is_for_sale: true,
        created_at: new Date(Date.now() - index * 1000).toISOString(),
        author_display_name: formatDisplayName(profile),
        author_at_name: formatAtName(profile),
        author_username: profile.username ?? null,
        author_theme: profile.theme_settings ?? null,
        author_verified_badge: true,
        author_member_number: profile.member_number ?? null,
        is_shop_listing: true,
      });
    }
  }

  const mergedRows = [...rows, ...shopListingRows].sort((a, b) => {
    const aTime = Date.parse(a.created_at || "");
    const bTime = Date.parse(b.created_at || "");
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

  return mergedRows
    .map((post) => {
      if (post.is_shop_listing) {
        return post;
      }
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
    })
    .filter((post) => {
      const author = profilesById.get(post.user_id);
      if (!viewerIsAdmin && post.user_id !== sessionUserId && isShadowBanned(author)) return false;
      if (search.trim()) {
        const text = (post.content || "").toLowerCase();
        if (!text.includes(search.trim().toLowerCase())) {
          return false;
        }
      }
      if (marketplaceOnly && !post.is_for_sale) return false;
      if (tab === "following") return true;
      if (tab === "all") return true;
      if (tab === "for_sale") return post.is_for_sale;
      if (tab === "sold_unavailable") return !post.is_for_sale && parsePostCategory(post.content) === "sold_unavailable";
      return parsePostCategory(post.content) === tab;
    });
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

function isSameInteractionMap(prev: InteractionMap, next: InteractionMap) {
  if (prev === next) return true;

  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;

  for (const key of nextKeys) {
    if (!(key in prev)) return false;

    const prevValue = prev[key];
    const nextValue = next[key];
    if (prevValue === nextValue) continue;

    if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
      return false;
    }
  }

  return true;
}

function removePostFromExploreCache(cache: ExplorePost[] | undefined, postId: string) {
  if (!cache) {
    return cache;
  }

  return cache.filter((post) => post.id !== postId);
}

function ReportPostButton({ postId, isSignedIn }: { postId: string; isSignedIn: boolean }) {
  const handleReport = useCallback(async () => {
    if (!isSignedIn) {
      alert("Please sign in before reporting posts.");
      return;
    }

    const reason = prompt("Reason for reporting this post?");
    if (!reason?.trim()) return;

    try {
      await submitModerationReport({
        type: "post",
        targetId: postId,
        reason: reason.trim(),
      });
      alert("Post reported. Thank you!");
    } catch (error: any) {
      alert(typeof error?.message === "string" ? error.message : "Could not submit report. Please try again.");
    }
  }, [isSignedIn, postId]);
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
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [marketplaceOnly, setMarketplaceOnly] = useState(false);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [interactionBusyPostId, setInteractionBusyPostId] = useState<string | null>(null);
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostContent, setEditPostContent] = useState("");
  const [editPostAffiliateProductIds, setEditPostAffiliateProductIds] = useState<string[]>([]);

  const { data: posts = [], isLoading, error, refetch } = useQuery({
    queryKey: ["explorePosts", tab, search.trim(), marketplaceOnly, sessionUserId, viewerIsAdmin, reloadKey],
    queryFn: fetchExplorePosts,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const postIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const postIdsKey = useMemo(() => postIds.join(","), [postIds]);

  const { data: interactionData = EMPTY_INTERACTIONS, refetch: refetchInteractions } = useQuery({
    queryKey: ["exploreInteractions", postIdsKey],
    queryFn: async () => {
      if (!postIds.length) return EMPTY_INTERACTIONS;
      const body = await dedupeApiFetchJson<{ interactionsByPostId?: InteractionMap }>(
        `/api/posts/interactions?postIds=${encodeURIComponent(postIds.join(","))}`,
        { cache: "no-store" }
      );
      return body.interactionsByPostId || EMPTY_INTERACTIONS;
    },
    enabled: postIds.length > 0,
    staleTime: 1000 * 15,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const [interactions, setInteractions] = useState<InteractionMap>(EMPTY_INTERACTIONS);

  useEffect(() => {
    const nextInteractions = interactionData ?? EMPTY_INTERACTIONS;
    setInteractions((prev) => (isSameInteractionMap(prev, nextInteractions) ? prev : nextInteractions));
  }, [interactionData]);

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
    const syncAuth = async () => {
      const authState = await resolveClientAuth(supabase);
      const nextUserId = authState.user?.id || null;
      setSessionUserId(nextUserId);
      if (nextUserId) {
        try {
          const profile = await fetchClientProfile<{ role?: string | null }>(supabase, nextUserId, "role", {
            ensureProfile: true,
          });
          setViewerIsAdmin(hasAdminAccess(nextUserId, profile?.role ?? null));
        } catch {
          setViewerIsAdmin(hasAdminAccess(nextUserId, null));
        }
      } else {
        setViewerIsAdmin(false);
      }
    };

    void syncAuth();
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSessionUserId(null);
        setViewerIsAdmin(false);
        return;
      }

      if (nextSession?.user?.id) {
        setSessionUserId(nextSession.user.id);
        void fetchClientProfile<{ role?: string | null }>(supabase, nextSession.user.id, "role", {
          ensureProfile: true,
        })
          .then((profile) => {
            setViewerIsAdmin(hasAdminAccess(nextSession.user.id, profile?.role ?? null));
          })
          .catch(() => {
            setViewerIsAdmin(hasAdminAccess(nextSession.user.id, null));
          });
        return;
      }

      void syncAuth();
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("public:explore-posts")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, (payload) => {
        const newRecord = (payload.new || null) as { id?: string; deleted_at?: string | null } | null;
        const oldRecord = (payload.old || null) as { id?: string; deleted_at?: string | null } | null;
        const postId = newRecord?.id || oldRecord?.id;

        if (postId && (payload.eventType === "DELETE" || (typeof newRecord?.deleted_at === "string" && newRecord.deleted_at))) {
          queryClient.setQueriesData<ExplorePost[]>({ queryKey: ["explorePosts"] }, (current) =>
            removePostFromExploreCache(current, postId)
          );

          setInteractions((prev) => {
            if (!(postId in prev)) {
              return prev;
            }

            const next = { ...prev };
            delete next[postId];
            return next;
          });
        }

        void queryClient.invalidateQueries({ queryKey: ["explorePosts"] });
        void queryClient.invalidateQueries({ queryKey: ["exploreInteractions"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const updatePostCounters = useCallback((postId: string, updates: Partial<Pick<ExplorePost, "likes" | "comments_count">>) => {
    queryClient.setQueryData<ExplorePost[]>(["explorePosts", tab, search.trim(), marketplaceOnly, sessionUserId, viewerIsAdmin, reloadKey], (currentPosts) =>
      (currentPosts || []).map((post) => (post.id === postId ? { ...post, ...updates } : post))
    );
  }, [queryClient, reloadKey, search, sessionUserId, tab, viewerIsAdmin, marketplaceOnly]);

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
      void refetch();
      void refetchInteractions();
    } catch (error: any) {
      setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
    }
  }, [refetch, refetchInteractions]);

  const handleDeletePost = useCallback(async (post: Pick<ExplorePost, "id" | "user_id" | "is_shop_listing">) => {
    if (!confirm("Delete this post? This cannot be undone.")) {
      return;
    }

    const query = new URLSearchParams({ postId: post.id });
    if (post.is_shop_listing) {
      query.set("sellerUserId", post.user_id);
    }

    const response = await fetch(`/api/posts/manage?${query.toString()}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setInteractionStatus(body?.error || "Could not delete post. Please try again.");
      return;
    }

    queryClient.setQueryData<ExplorePost[]>(["explorePosts", tab, search.trim(), marketplaceOnly, sessionUserId, viewerIsAdmin, reloadKey], (currentPosts) =>
      (currentPosts || []).filter((item) => item.id !== post.id)
    );
  }, [queryClient, reloadKey, search, sessionUserId, tab, viewerIsAdmin, marketplaceOnly]);

  const handleSavePostEdit = useCallback(async (postId: string) => {
    const content = editPostContent.trim();
    if (!content) {
      return;
    }

    const nextContent = buildPostContentWithAffiliateProducts(content, editPostAffiliateProductIds);
    const response = await fetch("/api/posts/manage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, content: nextContent }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setInteractionStatus(body?.error || "Could not update post. Please try again.");
      return;
    }

    const body = await response.json().catch(() => ({}));
    queryClient.setQueryData<ExplorePost[]>(["explorePosts", tab, search.trim(), marketplaceOnly, sessionUserId, viewerIsAdmin, reloadKey], (currentPosts) =>
      (currentPosts || []).map((post) => (post.id === postId ? { ...post, content: body.content || nextContent } : post))
    );
    setEditingPostId(null);
    setEditPostAffiliateProductIds([]);
  }, [editPostAffiliateProductIds, editPostContent, queryClient, reloadKey, search, sessionUserId, tab, viewerIsAdmin, marketplaceOnly]);

  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (!confirm("Delete this comment?")) {
      return;
    }

    const response = await fetch(`/api/posts/comments?commentId=${encodeURIComponent(commentId)}&postId=${encodeURIComponent(postId)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setInteractionStatus(body?.error || "Could not delete comment. Please try again.");
      return;
    }

    const body = await response.json().catch(() => ({}));
    setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
    updatePostCounters(postId, { comments_count: body.commentsCount ?? 0 });
  }, [updatePostCounters]);

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

      queryClient.setQueryData<ExplorePost[]>(["explorePosts", tab, search.trim(), marketplaceOnly, sessionUserId, viewerIsAdmin, reloadKey], (currentPosts) =>
        (currentPosts || []).filter((item) => item.id !== post.id)
      );
    } catch (e: any) {
      setInteractionStatus(typeof e?.message === "string" ? e.message : "Failed to update listing status.");
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
            prefetch={false}
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

        {isLoading ? (
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
            message={typeof error === "string" ? error : error?.message || "Failed to load explore."}
            actionLabel="Retry explore"
            onAction={() => setReloadKey((current) => current + 1)}
            className="mb-4"
          />
        ) : null}
        {interactionStatus ? <p className="mb-4 text-sm text-rose-200">{interactionStatus}</p> : null}
        {adminActionStatus ? <p className="mb-4 text-sm text-cyan-100">{adminActionStatus}</p> : null}

        {!isLoading && !error && posts.length === 0 && (
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
            const visibleContent = stripCategoryTag(stripAffiliateProductTokens(post.content));
            const hasImage = Boolean(post.image_urls?.length);

            return (
            <article
              key={post.id}
              className={`rounded-3xl border-4 bg-[var(--post-bg,rgba(7,17,31,0.7))] p-4 shadow-[0_0_0_4px_rgba(0,0,0,0.18),0_8px_32px_0_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-5 ${post.author_verified_badge ? "border-amber-400 ring-2 ring-amber-400" : "border-gradient-tiedye"} ${fontClass(post.author_theme?.font_style)}`}
              ref={(element) => applyPostThemeVars(element, post.author_theme)}
            >
              {post.image_urls?.[0] ? (
                  <button type="button" className="group relative mb-4 block aspect-[4/5] w-full overflow-hidden rounded-2xl border border-cyan-300/10 bg-slate-950 sm:aspect-[4/3]" onClick={() => setLightbox({ open: true, images: post.image_urls || [], index: 0 })}>
                    <Image src={post.image_urls[0]} alt="Post" className="h-full w-full rounded-2xl object-contain p-2 transition duration-200 group-hover:scale-[1.02]" loading="lazy" fill unoptimized />
                    {post.image_urls.length > 1 ? (
                      <span className="absolute right-3 top-3 rounded-full border border-black/15 bg-black/55 px-2 py-1 text-[11px] font-semibold text-cyan-50 shadow-lg backdrop-blur-sm">
                        {post.image_urls.length} photos
                      </span>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-3 py-4 text-left text-xs text-cyan-50/85 sm:text-sm">Tap to expand</div>
                  </button>
              ) : null}
                {editingPostId === post.id ? (
                <div className="space-y-3 rounded-3xl border border-cyan-300/20 bg-slate-950/40 p-4">
                  <label className="block text-sm font-semibold text-cyan-100">Edit post</label>
                  <textarea
                    value={editPostContent}
                    onChange={(event) => setEditPostContent(event.target.value)}
                    className="min-h-[128px] w-full rounded-2xl border border-cyan-300/30 bg-black/40 px-4 py-3 text-sm text-cyan-100 outline-none placeholder:text-cyan-300/60"
                    placeholder="Update your post content"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/25 bg-black/20 px-4 py-2 text-xs text-cyan-100 hover:bg-cyan-900/30 transition"
                      onClick={() => void handleSavePostEdit(post.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-600 bg-black/20 px-4 py-2 text-xs text-slate-200 hover:bg-slate-900/30 transition"
                      onClick={() => setEditingPostId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <InlineEmojiText
                  text={visibleContent || "No description provided."}
                  className={`block whitespace-pre-wrap text-[color:var(--post-text)]/92 ${hasImage ? "text-sm leading-6 sm:text-base sm:leading-7" : "rounded-2xl border border-cyan-300/15 bg-black/15 px-4 py-4 text-base leading-8 sm:text-lg"}`}
                />
              )}
              <PostAffiliateProducts content={post.content} className="mt-3" />
              {sessionUserId ? (
                <div className="flex flex-wrap items-center gap-3">
                  <EmojiPicker
                    mode="reaction"
                    reactionLayout="floating-inline"
                    align="left"
                    disabled={isBusy}
                    triggerAriaLabel="React to post"
                    triggerClassName="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/20 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60"
                    triggerContent={
                      <>
                        {selectedPostReaction ? (
                          <CustomEmojiImage src={selectedPostReaction.url} alt={selectedPostReaction.name} className="h-4 w-4 object-contain" title={selectedPostReaction.name} />
                        ) : (
                          <Heart className="h-4 w-4" />
                        )}
                        <span className="text-sm">{totalPostReactions}</span>
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
                    aria-label={isCommentsOpen ? "Hide comments" : "Show comments"}
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-sm">{post.comments_count}</span>
                  </button>
                  <ReportPostButton postId={post.id} isSignedIn={!!sessionUserId} />
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
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-cyan-300/10 pt-4">
                {(viewerIsAdmin || sessionUserId === post.user_id) && post.is_for_sale ? (
                  <>
                    {sessionUserId === post.user_id ? (
                      post.is_shop_listing && post.author_username ? (
                        <Link
                          href={`/profile/${encodeURIComponent(post.author_username)}/shop/manage`}
                          className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 transition hover:bg-cyan-900/30"
                        >
                          Edit
                        </Link>
                      ) : editingPostId !== post.id ? (
                        <button
                          type="button"
                          className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-900/30 transition"
                          onClick={() => {
                            setEditingPostId(post.id);
                            setEditPostContent(stripAffiliateProductTokens(post.content));
                            setEditPostAffiliateProductIds(extractAffiliateProductIds(post.content));
                          }}
                        >
                          Edit
                        </button>
                      ) : null
                    ) : null}
                    {sessionUserId === post.user_id ? (
                      <button
                        type="button"
                        className="rounded-full border border-rose-300/25 bg-black/20 px-3 py-1 text-xs text-rose-300 transition hover:bg-rose-900/30"
                        onClick={() => void handleDeletePost(post)}
                      >
                        Delete
                      </button>
                    ) : null}
                    {viewerIsAdmin ? (
                      <>
                        <button
                          type="button"
                          className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/20"
                          onClick={() => void handleDeletePost(post)}
                        >
                          Remove Listing
                        </button>
                        <AdminActionMenu targetUserId={post.user_id} onAction={handleAdminAction} label="ADMIN" />
                      </>
                    ) : null}
                  </>
                ) : !post.is_shop_listing && (viewerIsAdmin || sessionUserId === post.user_id) ? (
                  <>
                    {sessionUserId === post.user_id && editingPostId !== post.id ? (
                      <button
                        type="button"
                        className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 hover:bg-cyan-900/30 transition"
                        onClick={() => {
                          setEditingPostId(post.id);
                          setEditPostContent(stripAffiliateProductTokens(post.content));
                          setEditPostAffiliateProductIds(extractAffiliateProductIds(post.content));
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-full border border-rose-300/25 bg-black/20 px-3 py-1 text-xs text-rose-300 transition hover:bg-rose-900/30"
                      onClick={() => void handleDeletePost(post)}
                    >
                      Delete
                    </button>
                    {viewerIsAdmin ? <AdminActionMenu targetUserId={post.user_id} onAction={handleAdminAction} /> : null}
                  </>
                ) : null}
                {post.is_for_sale && !post.is_shop_listing && sessionUserId && post.user_id === sessionUserId ? (
                  <>
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
                  </>
                ) : null}
              </div>
              <div className="mt-4 space-y-3 rounded-2xl border border-cyan-800/40 bg-slate-950/45 px-4 py-3">
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
                <div className="flex flex-wrap gap-2">
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
                  {getCategoryMeta(post.content) ? (
                    <Link
                      href={`/explore?tab=${encodeURIComponent(getCategoryMeta(post.content)!.value)}`}
                      className="inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-300/30"
                    >
                      {getCategoryMeta(post.content)!.label}
                    </Link>
                  ) : null}
                </div>
                <div className="text-xs text-[color:var(--post-text)]/75">{new Date(post.created_at).toLocaleString()}</div>
              </div>

              {!post.is_shop_listing && isCommentsOpen ? (
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
                              <div className="flex items-start justify-between gap-3">
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
                                {viewerIsAdmin ? <AdminActionMenu targetUserId={comment.author.id} onAction={handleAdminAction} label="Admin Tools" /> : null}
                              </div>
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
                              {(sessionUserId === comment.author.id || viewerIsAdmin) ? (
                                <div className="mt-2 flex gap-3">
                                  <button
                                    type="button"
                                    className="text-xs text-rose-400 transition hover:underline"
                                    onClick={() => void handleDeleteComment(comment.id, post.id)}
                                  >
                                    Delete
                                  </button>
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
