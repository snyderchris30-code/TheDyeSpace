import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type Database } from "@/types/database";

type Props = {
  params: {
    username: string;
  };
};

function getPreviewImage(urls: string[] | null) {
  if (!urls || urls.length === 0) return null;
  return urls[0];
}

export default async function ShopPage({ params: { username } }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: profileData } = await supabase
    .from("profiles")
    .select("id,username,display_name,verified_badge,member_number,avatar_url")
    .eq("username", username)
    .limit(1)
    .maybeSingle();

  if (!profileData || !profileData.verified_badge) {
    return notFound();
  }

  const { data: postsData } = await supabase
    .from("posts")
    .select("id,content,image_urls,likes,comments_count,created_at")
    .eq("user_id", profileData.id)
    .eq("is_for_sale", true)
    .order("created_at", { ascending: false });

  const listings = Array.isArray(postsData) ? postsData : [];
  const sellerName = profileData.display_name || profileData.username || "Seller";

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/90 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan-300/70">Shop Listings</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">{sellerName}'s For Sale Listings</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Clean and curated items marked for sale by this verified seller. Browse the latest listings and reach out through the seller's fan chat for questions.
              </p>
            </div>
            <Link
              href={`/profile/${encodeURIComponent(username)}`}
              className="rounded-2xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
            >
              Back to Profile
            </Link>
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="rounded-[1.75rem] border border-cyan-300/15 bg-black/40 p-8 text-center text-slate-300 shadow-lg">
            <p className="text-xl font-semibold text-white">No active sale listings yet.</p>
            <p className="mt-2 text-sm text-slate-400">This verified seller has not marked any posts as for sale.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {listings.map((post) => {
              const previewImage = getPreviewImage(post.image_urls as string[] | null);
              return (
                <div key={post.id} className="overflow-hidden rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 shadow-2xl">
                  {previewImage ? (
                    <div className="relative h-56 w-full overflow-hidden">
                      <img
                        src={previewImage}
                        alt="Listing image"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="space-y-4 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70">For Sale</p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">Posted on {new Date(post.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">Ask</div>
                    </div>
                    <p className="text-sm leading-6 text-slate-200">{post.content || "No description provided."}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>{post.likes} likes</span>
                      <span>{post.comments_count} comments</span>
                    </div>
                    <Link
                      href={`/profile/${encodeURIComponent(username)}`}
                      className="inline-flex items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
                    >
                      Contact seller
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
