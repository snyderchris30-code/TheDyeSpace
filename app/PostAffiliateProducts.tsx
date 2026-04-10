"use client";

import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

import { getAffiliateProductsForPostContent } from "@/lib/post-affiliate-products";

type PostAffiliateProductsProps = {
  content: string | null;
  className?: string;
};

export default function PostAffiliateProducts({ content, className }: PostAffiliateProductsProps) {
  const products = getAffiliateProductsForPostContent(content);
  const [open, setOpen] = useState(false);

  if (!products.length) {
    return null;
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="inline-flex w-full items-center justify-between rounded-full border border-cyan-300/20 bg-black/20 px-4 py-3 text-left text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/30"
      >
        <span>Product Links</span>
        <span className="inline-flex items-center gap-2 text-xs text-cyan-200">
          {products.length} link{products.length === 1 ? "" : "s"}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          {products.map((product) => (
            <a
              key={product.id}
              href={product.affiliateUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 rounded-2xl border border-cyan-300/15 bg-black/20 p-3 transition hover:border-cyan-300/35 hover:bg-black/30"
            >
              <img
                src={product.thumbnailUrl}
                alt={product.name}
                className="h-12 w-12 rounded-xl border border-cyan-300/20 bg-slate-900 object-cover shadow"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-cyan-50">{product.name}</span>
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100/80">
                    {product.provider}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-cyan-100/75">{product.description}</p>
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-200 transition group-hover:text-cyan-50">
                  Open product
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
