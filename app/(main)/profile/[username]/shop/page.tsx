"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { MessageCircle, Store } from "lucide-react";
import AdminActionMenu from "@/app/AdminActionMenu";
import UserIdentity from "@/app/UserIdentity";
import { createClient } from "@/lib/supabase/client";
import { resolveClientAuth, fetchClientProfile } from "@/lib/client-auth";
import { fetchProfileLookupByUsername, type ProfileLookupResponse } from "@/lib/profile-fetch";
import { normalizePostImageUrls } from "@/lib/post-media";
import { buildShopListingId } from "@/lib/shop-listings";
import { normalizeSellerProducts } from "@/lib/verified-seller";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import { hasAdminAccess, runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import type { ProfileThemeSettings, SellerProduct } from "@/types/database";

const shopProfileLoadPromises = new Map<string, Promise<ProfileLookupResponse<ShopProfile>>>();
const shopPostLoadPromises = new Map<string, Promise<ForSalePost[]>>();

type ForSalePost = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  created_at: string;
  is_shop_listing: boolean;
};

type ShopProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings: ProfileThemeSettings | null;
  verified_badge?: boolean;
  member_number?: number | null;
};

function getPreviewImage(urls?: string[] | null) {
  if (!urls || urls.length === 0) {
    return null;
  }
  return urls[0];
}

function resolveParamUsername(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return sanitizeUsernameInput(decodeURIComponent(raw || "").trim());
}

export default function ShopPage() {
  const params = useParams<{ username?: string | string[] }>();
  const username = resolveParamUsername(params?.username);
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopProducts, setShopProducts] = useState<SellerProduct[]>([]);
  const [salePosts, setSalePosts] = useState<ForSalePost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [interactionStatus, setInteractionStatus] = useState<string | null>(null);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    document.documentElement.style.removeProperty("--seller-background-image");
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadKey = username || "";

    if (!username) {
      if (active) {
        setProfile(null);
        setLoading(false);
      }
      return;
    }

    const fetchProfile = async () => {
      setLoading(true);
      try {
        let profilePromise = shopProfileLoadPromises.get(loadKey);
        if (!profilePromise) {
          profilePromise = fetchProfileLookupByUsername<ShopProfile>(username, controller.signal);
          shopProfileLoadPromises.set(loadKey, profilePromise);
          profilePromise.finally(() => {
            if (shopProfileLoadPromises.get(loadKey) === profilePromise) {
              shopProfileLoadPromises.delete(loadKey);
            }
          });
        }

        const body = await profilePromise;
        if (!active || controller.signal.aborted) return;
        const nextProfile = body.profile ?? null;
        setProfile(nextProfile);
        setShopProducts(normalizeSellerProducts(nextProfile?.theme_settings?.shop_products));
      } catch {
        if (!active || controller.signal.aborted) return;
        setProfile(null);
        setShopProducts([]);
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    };

    void fetchProfile();

    return () => {
      active = false;
      controller.abort();
    };
  }, [username]);

  useEffect(() => {
    let active = true;
    const profileUserId = profile?.id;
    if (!profileUserId) {
      setSalePosts([]);
      setPostsLoading(false);
      return;
    }

    const loadKey = profileUserId;
    const fetchPosts = async () => {
      setPostsLoading(true);

      let postsPromise = shopPostLoadPromises.get(loadKey);
      if (!postsPromise) {
        postsPromise = (async () => {
          const { data, error } = await supabase
            .from("posts")
            .select("id, user_id, content, image_urls, created_at")
            .eq("user_id", profileUserId)
            .eq("is_for_sale", true)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

          if (error) {
            throw error;
          }

          return ((data || []) as ForSalePost[]).map((post) => ({
            ...post,
            image_urls: normalizePostImageUrls(post.image_urls),
            is_shop_listing: false,
          }));
        })();

        shopPostLoadPromises.set(loadKey, postsPromise);
        postsPromise.finally(() => {
          if (shopPostLoadPromises.get(loadKey) === postsPromise) {
            shopPostLoadPromises.delete(loadKey);
          }
        });
      }

      try {
        const nextPosts = await postsPromise;
        if (!active) return;
        setSalePosts(nextPosts);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load for sale posts:", error);
        setSalePosts([]);
      } finally {
        if (active) setPostsLoading(false);
      }
    };

    void fetchPosts();

    return () => {
      active = false;
    };
  }, [profile?.id, supabase]);

  useEffect(() => {
    let active = true;
    const profileUserId = profile?.id;
    if (!profileUserId) {
      setIsOwner(false);
      return;
    }

    const loadOwnerStatus = async () => {
      try {
        const auth = await resolveClientAuth(supabase);
        if (!active) return;
        setIsOwner(Boolean(auth.user?.id && auth.user.id === profileUserId));
        if (auth.user?.id) {
          try {
            const profile = await fetchClientProfile<{ role?: string | null }>(supabase, auth.user.id, "role");
            if (!active) return;
            setIsAdmin(hasAdminAccess(auth.user.id, profile?.role ?? null));
          } catch {
            if (!active) return;
            setIsAdmin(hasAdminAccess(auth.user.id, null));
          }
        } else {
          setIsAdmin(false);
        }
      } catch {
        if (!active) return;
        setIsOwner(false);
        setIsAdmin(false);
      }
    };

    void loadOwnerStatus();

    return () => {
      active = false;
    };
  }, [profile?.id, supabase]);

  const sellerName = profile?.username || username || profile?.display_name || "Seller";
  const profileHref = username ? `/profile/${encodeURIComponent(username)}` : "/profile";
  const fanChatHref = username ? `/profile/${encodeURIComponent(username)}/fan-chat` : "/profile";
  const manageShopHref = username ? `/profile/${encodeURIComponent(username)}/shop/manage` : null;

  const handleAdminAction = async (targetUserId: string, action: AdminActionName, durationHours?: number) => {
    setAdminActionStatus(null);
    try {
      const body = await runAdminUserAction({ targetUserId, action, durationHours });
      setAdminActionStatus(body?.message || "Admin action applied successfully.");
    } catch (error: any) {
      setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
    }
  };

  const handleDeleteListing = async (post: ForSalePost) => {
    if (!confirm("Delete this listing? This cannot be undone.")) {
      return;
    }

    setInteractionStatus(null);
    const query = new URLSearchParams({ postId: post.id });
    if (post.is_shop_listing) {
      query.set("sellerUserId", post.user_id);
    }

    const response = await fetch(`/api/posts/manage?${query.toString()}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setInteractionStatus(body?.error || "Could not remove listing. Please try again.");
      return;
    }

    if (post.is_shop_listing) {
      setShopProducts((prev) => prev.filter((product) => buildShopListingId(post.user_id, product.id) !== post.id));
    } else {
      setSalePosts((prev) => prev.filter((item) => item.id !== post.id));
    }
  };

  const visibleListings = shopProducts.length > 0
    ? shopProducts.map((product) => ({
        id: buildShopListingId(profile?.id || "", product.id),
        user_id: profile?.id || "",
        content: [product.title, product.price ? `$${product.price}` : null, product.description]
          .filter(Boolean)
          .join(" • "),
        image_urls: product.photo_urls || null,
        created_at: "",
        is_shop_listing: true,
      }))
    : salePosts;

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/90 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan-300/70">Verified Seller Shop</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">{sellerName}&apos;s Shop</h1>
              <p className="mt-2 text-sm text-slate-300">Browse product listings with photos, prices, and descriptions.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={profileHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/25 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Store className="h-4 w-4" />
                Back to Profile
              </Link>
              <Link
                href={fanChatHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
              >
                <MessageCircle className="h-4 w-4" />
                Fan Chat
              </Link>
              {profile?.verified_badge === true && isOwner ? (
                <Link
                  href={`/profile/${encodeURIComponent(username)}/shop/manage`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/60 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
                >
                  Manage My Shop
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        {interactionStatus ? (
          <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {interactionStatus}
          </div>
        ) : null}
        {adminActionStatus ? (
          <div className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            {adminActionStatus}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 p-8 text-center text-slate-300 shadow-xl">
            Loading shop...
          </div>
        ) : (
          <div>
            {visibleListings.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {visibleListings.map((post) => (
                  <div key={post.id} className="rounded-[1.5rem] border border-cyan-300/10 bg-slate-950/80 p-4 shadow-xl">
                    {getPreviewImage(post.image_urls) ? (
                      <div className="mb-3 flex min-h-[18rem] items-center justify-center overflow-hidden rounded-2xl border border-cyan-300/10 bg-slate-950 p-2">
                        <img src={getPreviewImage(post.image_urls) ?? ""} alt="Sale item" className="max-h-[28rem] w-full object-contain" />
                      </div>
                    ) : null}
                    <p className="text-sm text-slate-200">{post.content || "No description"}</p>
                    <div className="mt-4 space-y-3 rounded-2xl border border-cyan-300/10 bg-black/20 px-4 py-3">
                      <UserIdentity
                        displayName={profile?.display_name}
                        username={profile?.username}
                        verifiedBadge={profile?.verified_badge === true}
                        memberNumber={profile?.member_number ?? null}
                        className="min-w-0"
                        nameClassName="font-semibold text-slate-100 hover:text-white"
                        usernameClassName="text-xs text-cyan-300/80 hover:text-cyan-100 hover:underline"
                        metaClassName="text-xs text-slate-300/65"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                          For Sale
                        </span>
                      </div>
                      {post.created_at ? (
                        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/70">Posted {new Date(post.created_at).toLocaleDateString()}</p>
                      ) : null}
                    </div>
                    {(isOwner || isAdmin) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-cyan-300/10 pt-3">
                        {isOwner ? (
                          post.is_shop_listing && manageShopHref ? (
                            <Link
                              href={manageShopHref}
                              className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 transition hover:bg-cyan-900/30"
                            >
                              Edit
                            </Link>
                          ) : (
                            <Link
                              href={profileHref}
                              className="rounded-full border border-cyan-300/25 bg-black/20 px-3 py-1 text-xs text-cyan-300 transition hover:bg-cyan-900/30"
                            >
                              Edit
                            </Link>
                          )
                        ) : null}
                        {isOwner ? (
                          <button
                            type="button"
                            className="rounded-full border border-rose-300/25 bg-black/20 px-3 py-1 text-xs text-rose-300 transition hover:bg-rose-900/30"
                            onClick={() => void handleDeleteListing(post)}
                          >
                            Delete
                          </button>
                        ) : null}
                        {isAdmin ? (
                          <>
                            <button
                              type="button"
                              className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/20"
                              onClick={() => void handleDeleteListing(post)}
                            >
                              Remove Listing
                            </button>
                            <AdminActionMenu targetUserId={post.user_id} onAction={handleAdminAction} label="ADMIN" />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 p-8 text-center text-slate-300 shadow-xl">
                No items for sale right now.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
