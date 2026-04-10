"use client";

import type { ChangeEvent } from "react";
import { ImagePlus, Package2, Store, Trash2 } from "lucide-react";
import type { SellerProduct } from "@/types/database";

type VerifiedSellerShopEditorProps = {
  products: SellerProduct[];
  isUploading: boolean;
  onAddProduct: () => void;
  onDeleteProduct: (productId: string) => void;
  onProductFieldChange: (productId: string, field: "title" | "price" | "description", value: string) => void;
  onProductPhotosUpload: (productId: string, event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onRemoveProductPhoto: (productId: string, photoUrl: string) => void;
};

export default function VerifiedSellerShopEditor({
  products,
  isUploading,
  onAddProduct,
  onDeleteProduct,
  onProductFieldChange,
  onProductPhotosUpload,
  onRemoveProductPhoto,
}: VerifiedSellerShopEditorProps) {
  return (
    <div className="sm:col-span-2 rounded-2xl border border-emerald-300/20 bg-emerald-500/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-emerald-100">
            <Store className="h-4 w-4 text-emerald-300" />
            <p className="text-sm font-semibold">Manage My Shop</p>
          </div>
          <p className="mt-2 text-xs text-emerald-100/70">
            Create separate product entries with pricing, descriptions, and multiple photos. The first photo becomes the main catalog image.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-xl border border-emerald-300/35 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
          onClick={onAddProduct}
        >
          Add Product
        </button>
      </div>

      {products.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/10 bg-slate-950/50 p-6 text-center text-sm text-emerald-100/75">
          No products added yet. Start your catalog with your first listing.
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {products.map((product, index) => {
            const photos = Array.isArray(product.photo_urls) ? product.photo_urls : [];
            const mainPhoto = photos[0] || null;

            return (
              <div key={product.id} className="rounded-[1.5rem] border border-emerald-300/15 bg-slate-950/70 p-4 shadow-lg">
                <div className="flex flex-col gap-4 lg:flex-row">
                  <div className="lg:w-[18rem]">
                    <div className="flex h-52 items-center justify-center overflow-hidden rounded-[1.25rem] border border-emerald-300/10 bg-[linear-gradient(160deg,rgba(4,14,18,0.95),rgba(6,27,32,0.92),rgba(12,49,44,0.8))]">
                      {mainPhoto ? (
                        <img src={mainPhoto} alt={product.title || `Product ${index + 1}`} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="px-6 text-center text-sm text-emerald-100/65">
                          <Package2 className="mx-auto mb-3 h-8 w-8 text-emerald-300/70" />
                          Upload a main product photo
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {photos.map((photoUrl) => (
                        <div key={photoUrl} className="group relative h-16 w-16 overflow-hidden rounded-xl border border-emerald-300/10 bg-black/30">
                          <img src={photoUrl} alt="Product thumbnail" className="h-full w-full object-cover" loading="lazy" />
                          <button
                            type="button"
                            className="absolute inset-x-1 bottom-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100"
                            onClick={() => onRemoveProductPhoto(product.id, photoUrl)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>

                    <label className="mt-3 inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-black/30 px-4 py-2 text-sm text-emerald-100 transition hover:bg-black/45">
                      <ImagePlus className="h-4 w-4" />
                      {isUploading ? "Uploading..." : "Upload Photos"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => void onProductPhotosUpload(product.id, event)}
                        disabled={isUploading}
                      />
                    </label>
                    <p className="mt-2 text-[11px] text-emerald-100/55">Up to 6 photos per product. The first photo is used as the main image.</p>
                  </div>

                  <div className="flex-1 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-emerald-300/70">Product {index + 1}</p>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20"
                        onClick={() => onDeleteProduct(product.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr),12rem]">
                      <label className="block">
                        <span className="mb-2 block text-sm text-emerald-100">Product title</span>
                        <input
                          className="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-white outline-none focus:border-emerald-300/50"
                          value={product.title}
                          onChange={(event) => onProductFieldChange(product.id, "title", event.target.value)}
                          placeholder="Hand-painted customs"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm text-emerald-100">Price</span>
                        <div className="flex h-11 items-center rounded-xl border border-white/15 bg-black/30 px-3 text-white focus-within:border-emerald-300/50">
                          <span className="mr-2 text-emerald-200">$</span>
                          <input
                            className="w-full bg-transparent text-white outline-none"
                            value={product.price || ""}
                            onChange={(event) => onProductFieldChange(product.id, "price", event.target.value)}
                            placeholder="120.00"
                            inputMode="decimal"
                          />
                        </div>
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-2 block text-sm text-emerald-100">Short description</span>
                      <textarea
                        className="min-h-28 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-emerald-300/50"
                        value={product.description || ""}
                        onChange={(event) => onProductFieldChange(product.id, "description", event.target.value)}
                        placeholder="Describe the style, size, turnaround time, and anything buyers should know."
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
