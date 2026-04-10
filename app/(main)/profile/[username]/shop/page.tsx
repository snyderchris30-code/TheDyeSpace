import Link from "next/link";
import { MessageCircle, Package2, ShieldCheck, Store } from "lucide-react";
import { notFound } from "next/navigation";
import { normalizeSellerProducts } from "@/lib/verified-seller";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileThemeSettings } from "@/types/database";

type Props = {
  params: {
    username: string;
  };
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

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "VS";
}

export default async function ShopPage({ params: { username } }: Props) {
  const supabase = await createSupabaseServerClient();
  const [{ data: profileData }, { data: sessionData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,username,display_name,verified_badge,member_number,avatar_url,theme_settings")
      .eq("username", username)
      .limit(1)
      .maybeSingle(),
    supabase.auth.getSession(),
  ]);

  if (!profileData || !profileData.verified_badge) {
    return notFound();
  }

  const sellerThemeSettings = (profileData.theme_settings ?? {}) as ProfileThemeSettings;
  const listings = normalizeSellerProducts(sellerThemeSettings.shop_products);
  const sellerName = profileData.display_name || profileData.username || "Seller";
  const sellerInitials = getInitials(sellerName);
  const sellerBackground = typeof sellerThemeSettings.seller_background_url === "string" ? sellerThemeSettings.seller_background_url : null;
  const fanChatHref = `/profile/${encodeURIComponent(username)}/fan-chat`;
  const profileHref = `/profile/${encodeURIComponent(username)}`;
  const isOwner = sessionData?.session?.user?.id === profileData.id;

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="relative overflow-hidden rounded-[2.25rem] border border-cyan-300/20 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
          {sellerBackground ? (
            <img
              src={sellerBackground}
              alt="Seller background"
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
          <div
            className={`absolute inset-0 ${
              sellerBackground
                ? "bg-[linear-gradient(135deg,rgba(2,6,23,0.92),rgba(7,24,39,0.84),rgba(8,55,68,0.68))]"
                : "bg-[linear-gradient(135deg,rgba(2,6,23,0.96),rgba(8,23,38,0.94),rgba(6,63,70,0.8))]"
            }`}
            aria-hidden="true"
          />
          <div className="relative z-10 flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-4">
              {profileData.avatar_url ? (
                <img
                  src={profileData.avatar_url}
                  alt={`${sellerName} avatar`}
                  className="h-20 w-20 rounded-[1.5rem] border border-white/15 object-cover shadow-xl"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-white/15 bg-white/10 text-2xl font-black text-white shadow-xl">
                  {sellerInitials}
                </div>
              )}

              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
                  <ShieldCheck className="h-4 w-4" />
                  Verified Seller Shop
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">{sellerName}&apos;s Shop</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200/90">
                  Browse a polished catalog of available products from this verified seller.
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-cyan-100/80">
                  {profileData.member_number != null ? (
                    <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5">Member #{profileData.member_number}</span>
                  ) : null}
                  <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5">{listings.length} product{listings.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href={fanChatHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/45 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/25"
              >
                <MessageCircle className="h-4 w-4" />
                Open Fan Chat
              </Link>
              <Link
                href={profileHref}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-black/25 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Store className="h-4 w-4" />
                Back to Profile
              </Link>
            </div>
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="rounded-[1.9rem] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(8,16,30,0.94),rgba(7,12,24,0.96))] p-10 text-center shadow-2xl">
            <Package2 className="mx-auto h-10 w-10 text-cyan-300/70" />
            <h2 className="mt-4 text-3xl font-semibold text-white">No products listed yet.</h2>
            <p className="mt-3 text-sm text-slate-300">This seller hasn&apos;t added any products yet. Check back later or send a message in fan chat.</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={profileHref}
                className="inline-flex items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
              >
                Back to Profile
              </Link>
              {isOwner ? (
                <Link
                  href={`${profileHref}?edit=1`}
                  className="inline-flex items-center justify-center rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                >
                  Add Product
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {listings.map((product) => {
              const previewImage = getPreviewImage(product.photo_urls);
              const galleryPhotos = (product.photo_urls || []).slice(1, 5);

              return (
                <article
                  key={product.id}
                  className="overflow-hidden rounded-[1.85rem] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(8,16,30,0.94),rgba(7,12,24,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
                >
                  <div className="relative h-64 overflow-hidden bg-slate-950">
                    {previewImage ? (
                      <img src={previewImage} alt={product.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center px-8 text-center text-cyan-100/70">
                        <Package2 className="mb-3 h-10 w-10 text-cyan-300/70" />
                        Product image coming soon
                      </div>
                    )}
                    <div className="absolute left-4 top-4 rounded-full border border-cyan-300/40 bg-slate-950/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100">
                      Product
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold text-white">{product.title}</h2>
                        <p className="mt-1 text-sm text-slate-300">From {sellerName}</p>
                      </div>
                      <div className="shrink-0 rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1.5 text-sm font-semibold text-cyan-100">
                        {formatPrice(product.price)}
                      </div>
                    </div>

                    <p className="min-h-[4.5rem] text-sm leading-6 text-slate-200/90">
                      {product.description || "Message the seller for details on availability, sizing, and shipping."}
                    </p>

                    {galleryPhotos.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {galleryPhotos.map((photoUrl) => (
                          <div key={photoUrl} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-cyan-300/10 bg-black/30">
                            <img src={photoUrl} alt={`${product.title} detail`} className="h-full w-full object-cover" loading="lazy" />
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <Link
                      href={fanChatHref}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Message Seller
                    </Link>
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
