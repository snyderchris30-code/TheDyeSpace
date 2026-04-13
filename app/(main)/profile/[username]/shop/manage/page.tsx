"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { Store } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { resolveClientAuth } from "@/lib/client-auth";
import { dedupeFetchJson } from "@/lib/dedupe-fetch";
import { normalizeSellerProducts } from "@/lib/verified-seller";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import type { SellerProduct } from "@/types/database";
import VerifiedSellerShopEditor from "../../VerifiedSellerShopEditor";

const MAX_SHOP_PRODUCT_PHOTOS = 6;

type ManageShopProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  verified_badge?: boolean;
  theme_settings?: {
    shop_products?: SellerProduct[] | null;
  } | null;
};

function resolveParamUsername(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return sanitizeUsernameInput(decodeURIComponent(raw || "").trim());
}

function createEmptyShopProduct(): SellerProduct {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `seller-product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    price: null,
    description: null,
    photo_urls: [],
  };
}

export default function ShopManagePage() {
  const params = useParams<{ username?: string | string[] }>();
  const username = resolveParamUsername(params?.username);
  const [profile, setProfile] = useState<ManageShopProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopProducts, setShopProducts] = useState<SellerProduct[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let active = true;

    const loadProfileAndAuth = async () => {
      if (!username) {
        if (active) {
          setProfile(null);
          setShopProducts([]);
          setIsOwner(false);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setStatus(null);

      let triedEnsure = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data, error } = await supabase
            .from("profiles")
            .select("id,username,display_name,verified_badge,theme_settings")
            .ilike("username", username)
            .limit(1)
            .maybeSingle();

          if (error) {
            throw error;
          }

          if (!data) {
            if (!triedEnsure) {
              // Try to auto-create the profile for the current user
              await dedupeFetchJson(`/api/profile/lookup?username=${encodeURIComponent(username)}`, {
                cache: "no-store",
              }, { cacheTtlMs: 3000 });
              triedEnsure = true;
              continue;
            }
            throw new Error("Profile not found.");
          }

          const normalizedProducts = normalizeSellerProducts(
            Array.isArray(data.theme_settings?.shop_products) ? data.theme_settings.shop_products : []
          );
          const auth = await resolveClientAuth(supabase);
          const owner = Boolean(auth.user?.id && auth.user.id === data.id);

          if (!active) {
            return;
          }

          setProfile({
            id: data.id,
            username: data.username,
            display_name: data.display_name,
            verified_badge: data.verified_badge,
            theme_settings: data.theme_settings ?? null,
          });
          setShopProducts(normalizedProducts);
          setIsOwner(owner);
          return;
        } catch (error: any) {
          if (!active) return;
          if (attempt === 1 || triedEnsure) {
            setProfile(null);
            setShopProducts([]);
            setIsOwner(false);
            setStatus({ type: "error", text: typeof error?.message === "string" ? error.message : "Failed to load shop management page." });
            break;
          }
        } finally {
          if (active) setLoading(false);
        }
      }
    };

    void loadProfileAndAuth();

    return () => {
      active = false;
    };
  }, [username, supabase]);

  const ensureProfileBuckets = useCallback(async () => {
    const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Storage is not ready for uploads right now.");
    }
  }, []);

  const addShopProduct = useCallback(() => {
    setShopProducts((prev) => [...prev, createEmptyShopProduct()]);
  }, []);

  const updateShopProduct = useCallback(
    (productId: string, field: "title" | "price" | "description", value: string) => {
      setShopProducts((prev) =>
        prev.map((product) =>
          product.id === productId
            ? {
                ...product,
                [field]: field === "title" ? value : value || null,
              }
            : product
        )
      );
    },
    []
  );

  const removeShopProduct = useCallback((productId: string) => {
    setShopProducts((prev) => prev.filter((product) => product.id !== productId));
  }, []);

  const removeShopProductPhoto = useCallback((productId: string, photoUrl: string) => {
    setShopProducts((prev) =>
      prev.map((product) =>
        product.id === productId
          ? {
              ...product,
              photo_urls: (product.photo_urls || []).filter((url) => url !== photoUrl),
            }
          : product
      )
    );
  }, []);

  const handleProductPhotosUpload = useCallback(
    async (productId: string, event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const files = Array.from(input.files || []);
      input.value = "";

      if (!files.length) {
        return;
      }

      const currentProduct = shopProducts.find((product) => product.id === productId);
      const existingPhotos = currentProduct?.photo_urls || [];
      const remainingSlots = Math.max(0, MAX_SHOP_PRODUCT_PHOTOS - existingPhotos.length);

      if (remainingSlots <= 0) {
        setStatus({ type: "error", text: `Each product can have up to ${MAX_SHOP_PRODUCT_PHOTOS} photos.` });
        return;
      }

      const selectedFiles = files.slice(0, remainingSlots);
      setIsUploading(true);
      setStatus(null);

      try {
        await ensureProfileBuckets();

        const uploadedUrls: string[] = [];

        for (const file of selectedFiles) {
          const uploadBody = new FormData();
          uploadBody.append("bucket", "posts");
          uploadBody.append("file", file);

          const uploadResponse = await fetch("/api/profile/upload", {
            method: "POST",
            body: uploadBody,
          });

          const uploadPayload = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || typeof uploadPayload?.publicUrl !== "string") {
            throw new Error(uploadPayload?.error || "Failed to upload your product photos.");
          }

          uploadedUrls.push(uploadPayload.publicUrl);
        }

        setShopProducts((prev) =>
          prev.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  photo_urls: [...(product.photo_urls || []), ...uploadedUrls],
                }
              : product
          )
        );

        setStatus({
          type: "success",
          text: `${uploadedUrls.length} product photo${uploadedUrls.length === 1 ? "" : "s"} uploaded.`,
        });
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Failed to upload your product photos.",
        });
      } finally {
        setIsUploading(false);
      }
    },
    [ensureProfileBuckets, shopProducts]
  );

  const handleSave = useCallback(async () => {
    if (!profile) {
      setStatus({ type: "error", text: "Unable to save because the profile did not load." });
      return;
    }

    setSaving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_products: normalizeSellerProducts(shopProducts) }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to save your shop.");
      }

      setStatus({ type: "success", text: "Shop saved successfully." });
    } catch (error: any) {
      setStatus({ type: "error", text: typeof error?.message === "string" ? error.message : "Failed to save your shop." });
    } finally {
      setSaving(false);
    }
  }, [profile, shopProducts]);

  const sellerName = profile?.display_name || profile?.username || username || "Your Shop";
  const shopHref = username ? `/profile/${encodeURIComponent(username)}/shop` : "/profile";

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-[2rem] border border-emerald-300/20 bg-slate-950/90 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-emerald-300/70">Manage My Shop</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">{sellerName}</h1>
              <p className="mt-2 text-sm text-slate-300">Upload products, edit listings, and keep your verified seller shop up to date.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={shopHref}
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-black/25 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Store className="h-4 w-4" />
                Back to Shop
              </Link>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isOwner || profile?.verified_badge !== true}
                className="inline-flex items-center justify-center rounded-2xl border border-emerald-300/60 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Shop"}
              </button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-[1.75rem] border border-emerald-300/15 bg-slate-950/80 p-8 text-center text-slate-300 shadow-xl">
            Loading shop management...
          </div>
        ) : !profile ? (
          <div className="rounded-[1.75rem] border border-rose-300/15 bg-slate-950/80 p-8 text-center text-rose-100 shadow-xl">
            Unable to find this shop profile.
          </div>
        ) : !isOwner || profile?.verified_badge !== true ? (
          <div className="rounded-[1.75rem] border border-amber-300/15 bg-slate-950/80 p-8 text-center text-amber-100 shadow-xl">
            {isOwner ? (
              <p>Your shop is not a verified seller storefront yet. Only verified sellers can manage product listings.</p>
            ) : (
              <p>Only the verified owner of this shop can access the shop management interface.</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {status ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  status.type === "success"
                    ? "border-emerald-300/30 bg-emerald-500/10 text-emerald-100"
                    : "border-rose-300/30 bg-rose-500/10 text-rose-100"
                }`}
              >
                {status.text}
              </div>
            ) : null}

            <VerifiedSellerShopEditor
              products={shopProducts}
              isUploading={isUploading}
              onAddProduct={addShopProduct}
              onDeleteProduct={removeShopProduct}
              onProductFieldChange={updateShopProduct}
              onProductPhotosUpload={handleProductPhotosUpload}
              onRemoveProductPhoto={removeShopProductPhoto}
            />
          </div>
        )}
      </div>
    </div>
  );
}
