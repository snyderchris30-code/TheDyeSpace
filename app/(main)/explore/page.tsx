"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { fontClass, resolveProfileAppearance, type ProfileAppearance } from "@/lib/profile-theme";

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

type FeedCategory = "all" | "tutorial" | "new_boot_goofin" | "for_sale" | "sold_unavailable";

const TABS: Array<{ label: string; value: FeedCategory }> = [
  { label: "All Posts", value: "all" },
  { label: "Tutorials", value: "tutorial" },
  { label: "New Boot Goofin", value: "new_boot_goofin" },
  { label: "For Sale", value: "for_sale" },
  { label: "Sold / No Longer Available", value: "sold_unavailable" },
];

function parsePostCategory(content: string | null): FeedCategory {
  const text = (content || "").toLowerCase();
  if (text.startsWith("[sold]") || text.startsWith("[unavailable]")) return "sold_unavailable";
  if (text.startsWith("[tutorial]")) return "tutorial";
  if (text.startsWith("[new_boot_goofin]")) return "new_boot_goofin";
  return "all";
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

export default function ExplorePage() {
  const [tab, setTab] = useState<FeedCategory>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setSessionUserId(data.user?.id || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSessionUserId(nextSession?.user?.id || null);
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
        let query = supabase
          .from("posts")
          .select("id,user_id,content,image_urls,likes,is_for_sale,created_at")
          .order("created_at", { ascending: false });

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
            console.error("Failed to load explore author profiles", profilesError);
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
  }, [tab, search]);

  const title = useMemo(() => {
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
    <div className="relative min-h-screen px-4 pb-16 pt-10 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 rounded-3xl border border-cyan-300/25 bg-slate-950/55 p-8 shadow-2xl backdrop-blur-xl">
          <h1 className="glow-text mb-3 text-4xl font-extrabold sm:text-6xl">Explore</h1>
          <p className="text-cyan-100/85 text-lg">Real posts only. This feed stays empty until users create posts.</p>
        </div>

        <div className="mb-5 flex flex-wrap gap-3">
          {TABS.map((t) => (
            <button
              key={t.value}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                tab === t.value
                  ? "border-cyan-200/60 bg-cyan-300 text-slate-950"
                  : "border-cyan-300/25 bg-black/35 text-cyan-100 hover:bg-black/55"
              }`}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mb-8">
          <input
            className="w-full rounded-2xl border border-cyan-300/25 bg-black/35 px-5 py-3 text-cyan-50 outline-none transition focus:border-cyan-200/55"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <h2 className="mb-4 text-2xl font-semibold text-cyan-50">{title}</h2>

        {loading && <p className="text-cyan-200">Loading posts...</p>}
        {error && <p className="text-rose-300">{error}</p>}

        {!loading && !error && posts.length === 0 && (
          <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100/75">
            No posts yet. The feed will populate when users publish posts.
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.id}
              className={`rounded-3xl border border-cyan-300/25 bg-slate-950/55 p-5 shadow-xl backdrop-blur-xl ${fontClass(post.author_theme?.font_style)}`}
              ref={(element) => applyPostThemeVars(element, post.author_theme)}
            >
              {post.image_urls?.[0] ? (
                <img src={post.image_urls[0]} alt="Post" className="mb-4 h-44 w-full rounded-2xl object-cover" />
              ) : null}
              <p className="mb-3 whitespace-pre-wrap text-[color:var(--post-text)]/92">{stripCategoryTag(post.content) || "No description provided."}</p>
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

              <div className="flex items-center justify-between text-xs text-[color:var(--post-text)]/75">
                <span>{new Date(post.created_at).toLocaleString()}</span>
                <span>{post.likes} likes</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
