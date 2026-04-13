"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { MessageCircle, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolveClientAuth } from "@/lib/client-auth";
import { fetchProfileLookupByUsername, type ProfileLookupResponse } from "@/lib/profile-fetch";
import { normalizePostImageUrls } from "@/lib/post-media";
import { normalizeSellerProducts } from "@/lib/verified-seller";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import type { ProfileThemeSettings, SellerProduct } from "@/types/database";

const shopProfileLoadPromises = new Map<string, Promise<ProfileLookupResponse<ShopProfile>>>();
const shopPostLoadPromises = new Map<string, Promise<ForSalePost[]>>();

type ForSalePost = {
  id: string;
  content: string | null;
  image_urls: string[] | null;
  created_at: string;
};

type ShopProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings: ProfileThemeSettings | null;
  verified_badge?: boolean;
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
            .select("id, content, image_urls, created_at")
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
      } catch {
        if (!active) return;
        setIsOwner(false);
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
  const visibleListings = shopProducts.length > 0
    ? shopProducts.map((product) => ({
        id: product.id,
        content: [product.title, product.price ? `$${product.price}` : null, product.description]
          .filter(Boolean)
          .join(" • "),
        image_urls: product.photo_urls || null,
        created_at: "",
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
                      <img src={getPreviewImage(post.image_urls) ?? ""} alt="Sale item" className="mb-3 w-full rounded-2xl object-cover" />
                    ) : null}
                    <p className="text-sm text-slate-200">{post.content || "No description"}</p>
                    {post.created_at ? (
                      <p className="mt-3 text-xs uppercase tracking-[0.24em] text-cyan-300/70">Posted {new Date(post.created_at).toLocaleDateString()}</p>
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
