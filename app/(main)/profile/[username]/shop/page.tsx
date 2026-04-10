"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { MessageCircle, Package2, Store } from "lucide-react";
import { normalizeSellerProducts } from "@/lib/verified-seller";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import type { ProfileThemeSettings } from "@/types/database";

type ShopProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  theme_settings: ProfileThemeSettings | null;
};

function getPreviewImage(urls?: string[] | null) {
  if (!urls || urls.length === 0) {
    return null;
  }

  return urls[0];
}

function formatPrice(price?: string | null) {
  if (!price) {
    return "Message Seller";
  }

  const parsed = Number.parseFloat(price);
  if (!Number.isFinite(parsed)) {
    return price;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
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

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!username) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const response = await fetch(`/api/profile/lookup?username=${encodeURIComponent(username)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      const nextProfile = response.ok && body?.profile ? (body.profile as ShopProfile) : null;

      if (active) {
        setProfile(nextProfile);
        setLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [username]);

  const sellerName = profile?.username || username || profile?.display_name || "Seller";
  const listings = useMemo(() => {
    const settings = (profile?.theme_settings ?? {}) as ProfileThemeSettings;
    return normalizeSellerProducts(settings.shop_products);
  }, [profile?.theme_settings]);
  const profileHref = username ? `/profile/${encodeURIComponent(username)}` : "/profile";
  const fanChatHref = username ? `/profile/${encodeURIComponent(username)}/fan-chat` : "/profile";

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
            </div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 p-8 text-center text-slate-300 shadow-xl">
            Loading shop...
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 p-10 text-center shadow-xl">
            <Package2 className="mx-auto h-10 w-10 text-cyan-300/70" />
            <h2 className="mt-4 text-2xl font-semibold text-white">No products yet</h2>
            <p className="mt-2 text-sm text-slate-300">This shop does not have any published products right now.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {listings.map((product) => {
              const previewImage = getPreviewImage(product.photo_urls);

              return (
                <article
                  key={product.id}
                  className="overflow-hidden rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/85 shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
                >
                  <div className="flex h-56 items-center justify-center bg-slate-900">
                    {previewImage ? (
                      <img src={previewImage} alt={product.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="px-6 text-center text-sm text-slate-400">No product photo</div>
                    )}
                  </div>
                  <div className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-semibold text-white">{product.title}</h2>
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-sm font-semibold text-cyan-100">
                        {formatPrice(product.price)}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">
                      {product.description || "No description provided for this product yet."}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
