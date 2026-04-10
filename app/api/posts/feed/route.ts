import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAdminAccess } from "@/lib/admin-actions";
import type { ProfileAppearance } from "@/lib/profile-theme";
import { normalizePostImageUrls } from "@/lib/post-media";

const PAGE_SIZE = 8;
const FEED_CACHE_TTL_MS = 10_000;

type FeedCacheEntry = {
  createdAt: number;
  payload: { posts: FeedPost[] };
};

const feedCache = new Map<string, FeedCacheEntry>();

type FeedPost = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  comments_count: number;
  is_for_sale: boolean;
  created_at: string;
  author_display_name: string;
  author_at_name: string;
  author_username: string | null;
  author_theme: ProfileAppearance | null;
  author_voided_until: string | null;
  author_verified_badge: boolean;
  author_member_number: number | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings?: ProfileAppearance | null;
  voided_until?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  role?: string | null;
};

function isShadowBanned(profile?: ProfileRow) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
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

export async function GET(request: NextRequest) {
  const before = request.nextUrl.searchParams.get("before");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const viewerId = user?.id ?? "anon";
  const cacheKey = `${viewerId}:${before ?? "first"}`;
  const now = Date.now();
  const cached = feedCache.get(cacheKey);
  if (cached && now - cached.createdAt < FEED_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=10, stale-while-revalidate=20",
      },
    });
  }

  let viewerIsAdmin = false;
  if (user?.id) {
    const { data: viewerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    viewerIsAdmin = hasAdminAccess(user.id, viewerProfile?.role ?? null);
  }

  let query = supabase
    .from("posts")
    .select("id,user_id,content,image_urls,likes,comments_count,is_for_sale,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: postsData, error: postsError } = await query;
  if (postsError) {
    return NextResponse.json({ error: postsError.message }, { status: 500 });
  }

  const posts = (postsData || []) as Array<FeedPost & { user_id: string }>;
  const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))];

  const profilesById = new Map<string, ProfileRow>();
  if (userIds.length) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id,username,display_name,theme_settings,voided_until,verified_badge,member_number,shadow_banned,shadow_banned_until")
      .in("id", userIds);

    if (!profilesError) {
      (profilesData || []).forEach((profile) => {
        profilesById.set((profile as ProfileRow).id, profile as ProfileRow);
      });
    }
  }

  const visiblePosts = posts.filter((post) => {
    const profile = profilesById.get(post.user_id);
    if (viewerIsAdmin) return true;
    if (user?.id && post.user_id === user.id) return true;
    return !isShadowBanned(profile);
  });

  const result = visiblePosts.map((post) => {
    const profile = profilesById.get(post.user_id);
    const imageUrls = normalizePostImageUrls(post.image_urls);
    return {
      ...post,
      image_urls: imageUrls.length ? imageUrls : null,
      author_display_name: formatDisplayName(profile),
      author_at_name: formatAtName(profile),
      author_username: profile?.username ?? null,
      author_theme: profile?.theme_settings ?? null,
      author_voided_until: profile?.voided_until ?? null,
      author_verified_badge: profile?.verified_badge === true,
      author_member_number: profile?.member_number ?? null,
    };
  });

  const payload = { posts: result };
  feedCache.set(cacheKey, { createdAt: now, payload });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, max-age=0, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
