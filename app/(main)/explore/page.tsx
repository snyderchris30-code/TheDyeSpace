
"use client";
import Image from "next/image";

import dynamic from "next/dynamic";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { fontClass, resolveProfileAppearance, type ProfileAppearance } from "@/lib/profile-theme";
import { Home, Users, BookOpen, PartyPopper, Tag, Ban } from "lucide-react";

type ExplorePost = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  is_for_sale: boolean;
  created_at: string;
  author_display_name?: string;
  author_at_name?: string;
  author_username?: string | null;
  author_theme?: ProfileAppearance | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings?: ProfileAppearance | null;
};

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
  const [lightbox, setLightbox] = useState<{ open: boolean; url: string | null }>({ open: false, url: null });
  const [tab, setTab] = useState<FeedCategory>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [marketplaceOnly, setMarketplaceOnly] = useState(false);

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
      setSessionUserId(data.session?.user?.id || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSessionUserId(null);
        return;
      }

      if (nextSession?.user?.id) {
        setSessionUserId(nextSession.user.id);
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
          .select("id,user_id,content,image_urls,likes,is_for_sale,created_at")
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
        const rows = (data || []) as ExplorePost[];

        const userIds = [...new Set(rows.map((post) => post.user_id).filter(Boolean))];
        const profilesById = new Map<string, ProfileRow>();

        if (userIds.length) {
          const { data: profilesData, error: profilesError } = await supabase
            .from("profiles")
            .select("id,username,display_name,theme_settings")
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
          };
        });

        const filtered = withAuthorNames.filter((post) => {
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
  }, [tab, search, marketplaceOnly]);

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
          <Link href="/chat" className="rounded-full border border-pink-400/60 bg-gradient-to-br from-cyan-900/60 to-pink-900/60 px-4 py-2 text-sm font-semibold text-pink-200 shadow-md hover:bg-pink-900/80 hover:text-white transition ml-auto">
            🚬 Smoke Lounge
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

        {loading && <p className="text-cyan-200">Loading posts...</p>}
        {error && <p className="text-rose-300">{error}</p>}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100/75">
            {tab === "following"
              ? "No posts in Following yet. Follow artists to build your feed."
              : "No posts yet. The feed will populate when users publish posts."}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.id}
              className={`rounded-3xl border border-cyan-300/25 bg-slate-950/55 p-4 shadow-xl backdrop-blur-xl sm:p-5 ${fontClass(post.author_theme?.font_style)}`}
              ref={(element) => applyPostThemeVars(element, post.author_theme)}
            >
              {post.image_urls?.[0] ? (
                  <button type="button" className="group relative mb-4 block aspect-[4/5] w-full overflow-hidden rounded-2xl sm:aspect-[4/3]" onClick={() => setLightbox({ open: true, url: post.image_urls![0] })}>
                    <Image src={post.image_urls[0]} alt="Post" className="h-full w-full rounded-2xl object-cover transition duration-200 group-hover:scale-105" loading="lazy" fill unoptimized />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-3 py-4 text-left text-xs text-cyan-50/85 sm:text-sm">Tap to expand</div>
                  </button>
              ) : null}
                <p className="mb-3 whitespace-pre-wrap text-sm leading-6 text-[color:var(--post-text)]/92 sm:text-base sm:leading-7">{stripCategoryTag(post.content) || "No description provided."}</p>
              <div className="mb-3">
                <Link
                  href={post.author_username ? `/profile/${post.author_username}` : '#'}
                  className="text-sm font-semibold text-[color:var(--post-text)] hover:text-[color:var(--post-highlight)] hover:underline"
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
                <span>{post.likes} likes</span>
              </div>
              <ReportPostButton postId={post.id} />
            </article>
          ))}
        </div>
        {lightbox.open && lightbox.url ? <LightboxModal imageUrl={lightbox.url} onClose={() => setLightbox({ open: false, url: null })} /> : null}
      </div>
    </div>
  );
}
