"use client";

import { Plus, Search, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import {
  getAffiliateProductById,
  searchAffiliateProducts,
  type AffiliateProduct,
} from "@/lib/post-affiliate-products";

type AffiliateProductPickerProps = {
  selectedProductIds: string[];
  onChange: (productIds: string[]) => void;
  className?: string;
};

function ProductThumb({ product }: { product: AffiliateProduct }) {
  return (
    <img
      src={product.thumbnailUrl}
      alt={product.name}
      className="h-14 w-14 rounded-2xl border border-cyan-300/20 bg-slate-900 object-cover shadow-lg"
    />
  );
}

export default function AffiliateProductPicker({ selectedProductIds, onChange, className }: AffiliateProductPickerProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const selectedProducts = useMemo(
    () => selectedProductIds
      .map((productId) => getAffiliateProductById(productId))
      .filter((product): product is AffiliateProduct => Boolean(product)),
    [selectedProductIds]
  );

  const results = useMemo(() => {
    const selectedProductSet = new Set(selectedProductIds);
    return searchAffiliateProducts(deferredQuery, 6).filter((product) => !selectedProductSet.has(product.id));
  }, [deferredQuery, selectedProductIds]);

  const addProduct = (productId: string) => {
    if (selectedProductIds.includes(productId)) {
      return;
    }

    onChange([...selectedProductIds, productId]);
    setQuery("");
  };

  const removeProduct = (productId: string) => {
    onChange(selectedProductIds.filter((id) => id !== productId));
  };

  return (
    <div className={className}>
      <label className="block">
        <span className="text-cyan-300">Add Product Links (optional)</span>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tie dye kit, procion dye, cotton shirt..."
            className="w-full rounded-2xl border border-cyan-300/20 bg-slate-950/75 py-3 pl-11 pr-4 text-white outline-none transition focus:border-cyan-300/45"
          />
        </div>
      </label>

      {query.trim() ? (
        <div className="mt-3 rounded-[1.5rem] border border-cyan-300/15 bg-black/20 p-3">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300/70">Matching products</p>
          {results.length ? (
            <div className="grid gap-2">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product.id)}
                  className="flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-slate-950/70 p-3 text-left transition hover:border-cyan-300/35 hover:bg-slate-950"
                >
                  <ProductThumb product={product} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-cyan-50">{product.name}</span>
                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100/80">
                        {product.provider}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-cyan-100/75">{product.description}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-cyan-100/70">No close matches yet. Try product names, materials, or brands.</p>
          )}
        </div>
      ) : null}

      {selectedProducts.length ? (
        <div className="mt-3 rounded-[1.5rem] border border-cyan-300/15 bg-black/20 p-3">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300/70">Selected products</p>
          <div className="grid gap-2">
            {selectedProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-3 rounded-2xl border border-cyan-300/15 bg-slate-950/70 p-3"
              >
                <ProductThumb product={product} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-cyan-50">{product.name}</span>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100/80">
                      {product.provider}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-cyan-100/75">{product.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeProduct(product.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-300/30 bg-rose-400/10 px-3 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/20"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
