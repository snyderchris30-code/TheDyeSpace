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
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300/70">Product Links</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {products.map((product) => (
          <a
            key={product.id}
            href={product.affiliateUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 rounded-[1.4rem] border border-cyan-300/15 bg-black/20 p-3 transition hover:border-cyan-300/35 hover:bg-black/30"
          >
            <img
              src={product.thumbnailUrl}
              alt={product.name}
              className="h-16 w-16 rounded-2xl border border-cyan-300/20 bg-slate-900 object-cover shadow-lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-cyan-50">{product.name}</span>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100/80">
                  {product.provider}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-cyan-100/75">{product.description}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 transition group-hover:text-cyan-50">
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
