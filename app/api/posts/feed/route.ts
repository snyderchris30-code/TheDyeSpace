import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileAppearance } from "@/lib/profile-theme";

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
  author_blessed_until: string | null;
};

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

export async function GET(request: NextRequest) {
  const before = request.nextUrl.searchParams.get("before");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("posts")
    .select("id,user_id,content,image_urls,likes,comments_count,is_for_sale,created_at")
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
      .select("id,username,display_name,theme_settings,voided_until,blessed_until")
      .in("id", userIds);

    if (!profilesError) {
      (profilesData || []).forEach((profile) => {
        profilesById.set((profile as ProfileRow).id, profile as ProfileRow);
      });
    }
  }

  const result = posts.map((post) => {
    const profile = profilesById.get(post.user_id);
    return {
      ...post,
      author_display_name: formatDisplayName(profile),
      author_at_name: formatAtName(profile),
      author_username: profile?.username ?? null,
      author_theme: profile?.theme_settings ?? null,
      author_voided_until: profile?.voided_until ?? null,
      author_blessed_until: profile?.blessed_until ?? null,
    };
  });

  return NextResponse.json({ posts: result });
}
