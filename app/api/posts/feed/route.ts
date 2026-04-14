import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAdminAccess } from "@/lib/admin-actions";
import type { ProfileAppearance } from "@/lib/profile-theme";
import { normalizePostImageUrls } from "@/lib/post-media";
import { normalizeSellerProducts } from "@/lib/verified-seller";

const PAGE_SIZE = 8;

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
  is_shop_listing?: boolean;
};

type PostRow = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  comments_count: number;
  is_for_sale: boolean;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  created_at?: string | null;
  theme_settings?: ProfileAppearance | null;
  voided_until?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  ghost_ridin?: boolean | null;
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

function isMissingColumnError(error: unknown) {
  const maybeError = error as { code?: string; message?: string };
  if (maybeError?.code === "42703") {
    return true;
  }
  const message = String(maybeError?.message || "").toLowerCase();
  return message.includes("column") && message.includes("does not exist");
}

export async function GET(request: NextRequest) {
  try {
    const before = request.nextUrl.searchParams.get("before");
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let viewerIsAdmin = false;
    if (user?.id) {
      const { data: viewerProfile, error: viewerProfileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (viewerProfileError) {
        console.error("Error fetching viewer profile:", viewerProfileError.message);
      }
      viewerIsAdmin = hasAdminAccess(user.id, viewerProfile?.role ?? null);
    }

    let posts: PostRow[] = [];
    {
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
      if (postsError && isMissingColumnError(postsError)) {
        let fallbackQuery = supabase
          .from("posts")
          .select("id,user_id,content,image_urls,created_at")
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);

        if (before) {
          fallbackQuery = fallbackQuery.lt("created_at", before);
        }

        const { data: fallbackPostsData, error: fallbackPostsError } = await fallbackQuery;
        if (fallbackPostsError) {
          console.error("Error fetching fallback posts:", fallbackPostsError.message);
          return NextResponse.json({ error: "Failed to fetch posts: " + fallbackPostsError.message }, { status: 500 });
        }

        posts = ((fallbackPostsData || []) as Array<{
          id: string;
          user_id: string;
          content: string | null;
          image_urls: string[] | null;
          created_at: string;
        }>).map((post) => ({
          ...post,
          likes: 0,
          comments_count: 0,
          is_for_sale: false,
        }));
      } else if (postsError) {
        console.error("Error fetching posts:", postsError.message);
        return NextResponse.json({ error: "Failed to fetch posts: " + postsError.message }, { status: 500 });
      } else {
        posts = (postsData || []) as PostRow[];
      }
    }
    const userIds = [...new Set(posts.map((post) => post.user_id).filter(Boolean))];

    const profilesById = new Map<string, ProfileRow>();
    if (userIds.length) {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id,username,display_name,created_at,theme_settings,voided_until,verified_badge,member_number,shadow_banned,shadow_banned_until,ghost_ridin")
        .in("id", userIds);

      let safeProfilesData = profilesData;
      if (profilesError && isMissingColumnError(profilesError)) {
        const { data: fallbackProfilesData, error: fallbackProfilesError } = await supabase
          .from("profiles")
          .select("id,username,display_name,theme_settings,voided_until")
          .in("id", userIds);
        if (fallbackProfilesError) {
          console.error("Error fetching fallback profiles:", fallbackProfilesError.message);
          return NextResponse.json({ error: "Failed to fetch profiles: " + fallbackProfilesError.message }, { status: 500 });
        }
        safeProfilesData = (fallbackProfilesData || []).map((profile: any) => ({
          ...profile,
          verified_badge: false,
          member_number: null,
          shadow_banned: false,
          shadow_banned_until: null,
          ghost_ridin: false,
        }));
      } else if (profilesError) {
        console.error("Error fetching profiles:", profilesError.message);
        return NextResponse.json({ error: "Failed to fetch profiles: " + profilesError.message }, { status: 500 });
      }

      (safeProfilesData || []).forEach((profile) => {
        profilesById.set((profile as ProfileRow).id, profile as ProfileRow);
      });
    }

    const { data: sellerProfilesData } = await supabase
      .from("profiles")
      .select("id,username,display_name,created_at,theme_settings,voided_until,verified_badge,member_number,shadow_banned,shadow_banned_until,ghost_ridin")
      .eq("verified_badge", true)
      .limit(200);

    const sellerProfiles = (sellerProfilesData || []) as ProfileRow[];
    sellerProfiles.forEach((profile) => {
      profilesById.set(profile.id, profile);
    });

    const shopListingPosts: FeedPost[] = sellerProfiles.flatMap((profile) => {
      const products = normalizeSellerProducts(profile.theme_settings?.shop_products);
      return products.map((product, index) => {
        const descriptionParts = [product.title?.trim(), product.price ? `$${product.price}` : null, product.description?.trim()]
          .filter(Boolean)
          .map(String);
        const imageUrls = normalizePostImageUrls(product.photo_urls || null);
        return {
          id: `shop-product-${profile.id}-${product.id}`,
          user_id: profile.id,
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
          author_voided_until: profile.voided_until ?? null,
          author_verified_badge: true,
          author_member_number: profile.member_number ?? null,
          is_shop_listing: true,
        } as FeedPost;
      });
    });

    const visiblePosts = posts.filter((post) => {
      const profile = profilesById.get(post.user_id);
      if (viewerIsAdmin) return true;
      if (user?.id && post.user_id === user.id) return true;
      return !isShadowBanned(profile);
    });

    const standardFeedPosts = visiblePosts.map((post) => {
      const profile = profilesById.get(post.user_id);
      const viewerOwnPost = Boolean(user?.id && post.user_id === user.id);
      const showGhostIdentity = profile?.ghost_ridin === true && !viewerIsAdmin && !viewerOwnPost;
      const imageUrls = normalizePostImageUrls(post.image_urls);
      return {
        ...post,
        image_urls: imageUrls.length ? imageUrls : null,
        author_display_name: showGhostIdentity ? "Ghost Rider" : formatDisplayName(profile),
        author_at_name: showGhostIdentity ? "Ghost Rider" : formatAtName(profile),
        author_username: showGhostIdentity ? null : profile?.username ?? null,
        author_theme: profile?.theme_settings ?? null,
        author_voided_until: profile?.voided_until ?? null,
        author_verified_badge: showGhostIdentity ? false : profile?.verified_badge === true,
        author_member_number: profile?.member_number ?? null,
      };
    });

    const visibleShopListings = shopListingPosts.filter((post) => {
      const profile = profilesById.get(post.user_id);
      if (viewerIsAdmin) return true;
      if (user?.id && post.user_id === user.id) return true;
      return !isShadowBanned(profile);
    });

    const result = [...standardFeedPosts, ...visibleShopListings]
      .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))
      .slice(0, PAGE_SIZE);

    return NextResponse.json({ posts: result }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    console.error("Unhandled error in feed API:", err);
    return NextResponse.json({ error: "Internal server error: " + (err?.message || err) }, { status: 500 });
  }
}
