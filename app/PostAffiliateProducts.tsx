import { ExternalLink } from "lucide-react";

import { getAffiliateProductsForPostContent } from "@/lib/post-affiliate-products";

type PostAffiliateProductsProps = {
  content: string | null;
  className?: string;
};

export default function PostAffiliateProducts({ content, className }: PostAffiliateProductsProps) {
  const products = getAffiliateProductsForPostContent(content);

  if (!products.length) {
    return null;
  }

  return (
    <div className={className}>
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-cyan-300/70">Product Links</p>
      <div className="space-y-2">
        {products.map((product) => (
          <a
            key={product.id}
            href={product.affiliateUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-2 rounded-xl border border-cyan-300/15 bg-black/20 p-2 transition hover:border-cyan-300/35 hover:bg-black/30"
          >
            <img
              src={product.thumbnailUrl}
              alt={product.name}
              className="h-10 w-10 rounded-lg border border-cyan-300/20 bg-slate-900 object-cover shadow"
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
    </div>
  );
}
