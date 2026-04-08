export type AffiliateProduct = {
  id: string;
  name: string;
  description: string;
  provider: string;
  affiliateUrl: string;
  thumbnailUrl: string;
  searchTerms: string[];
};

type AffiliateProductSeed = Omit<AffiliateProduct, "thumbnailUrl"> & {
  thumbnailLabel: string;
  thumbnailColors: [string, string];
};

const AFFILIATE_PRODUCT_TOKEN_PATTERN = /\[\[affiliate-product:([a-z0-9-]+)\]\]/gi;

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildThumbnailDataUrl(label: string, startColor: string, endColor: string) {
  const safeLabel = escapeSvgText(label.toUpperCase());
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" role="img" aria-label="${safeLabel}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${startColor}" />
          <stop offset="100%" stop-color="${endColor}" />
        </linearGradient>
      </defs>
      <rect width="240" height="180" rx="28" fill="url(#g)" />
      <circle cx="44" cy="44" r="18" fill="rgba(255,255,255,0.18)" />
      <circle cx="194" cy="54" r="28" fill="rgba(255,255,255,0.1)" />
      <rect x="26" y="118" width="188" height="32" rx="16" fill="rgba(8,15,26,0.26)" />
      <text x="120" y="85" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" letter-spacing="2">${safeLabel}</text>
      <text x="120" y="139" text-anchor="middle" fill="#dffcff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="600">TheDyeSpace Pick</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const AFFILIATE_PRODUCT_SEEDS: AffiliateProductSeed[] = [
  {
    id: "amazon-tie-dye-kit",
    name: "Beginner Tie-Dye Kit",
    description: "Starter bundle with bottles, gloves, and bold colors for easy weekend dye sessions.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=tie+dye+kit&tag=thedyespace-20",
    thumbnailLabel: "KIT",
    thumbnailColors: ["#0f766e", "#2563eb"],
    searchTerms: ["tie dye kit", "starter kit", "beginner kit", "dye set", "festival dye"],
  },
  {
    id: "dharma-procion-dye-set",
    name: "Procion MX Dye Set",
    description: "Reliable fiber-reactive dye picks for bright cotton and rayon projects.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=procion+mx+dye",
    thumbnailLabel: "DYE",
    thumbnailColors: ["#c026d3", "#0891b2"],
    searchTerms: ["procion dye", "fiber reactive dye", "mx dye", "dharma dye", "powder dye"],
  },
  {
    id: "amazon-cotton-shirt-pack",
    name: "Cotton Shirt Blank Pack",
    description: "Soft cotton blanks that work well for ice dye, spiral dye, and everyday practice runs.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=cotton+shirt+blank&tag=thedyespace-20",
    thumbnailLabel: "SHIRT",
    thumbnailColors: ["#7c3aed", "#ec4899"],
    searchTerms: ["cotton shirt", "blank tee", "blank shirt", "white shirt", "cotton blank"],
  },
  {
    id: "dharma-soda-ash-fixative",
    name: "Soda Ash Dye Fixative",
    description: "Pre-soak staple for locking color into fiber-reactive projects.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=soda+ash",
    thumbnailLabel: "FIX",
    thumbnailColors: ["#ea580c", "#eab308"],
    searchTerms: ["soda ash", "fixative", "dye prep", "color fixer", "pre soak"],
  },
  {
    id: "amazon-squeeze-bottle-set",
    name: "Squeeze Bottle Set",
    description: "Precision bottles for clean line work, geodes, and controlled palette layering.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=squeeze+bottles+for+tie+dye&tag=thedyespace-20",
    thumbnailLabel: "TOOLS",
    thumbnailColors: ["#dc2626", "#f97316"],
    searchTerms: ["squeeze bottle", "dye bottle", "applicator bottle", "tools", "bottle set"],
  },
  {
    id: "dharma-wax-sinew-bundle",
    name: "Waxed Sinew Bundle",
    description: "Helpful for tighter folds, geodes, and crisp resist patterns.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=waxed+sinew",
    thumbnailLabel: "SINEW",
    thumbnailColors: ["#1d4ed8", "#14b8a6"],
    searchTerms: ["waxed sinew", "resist string", "geode supplies", "binding string", "sinew"],
  },
];

export const AFFILIATE_PRODUCTS: AffiliateProduct[] = AFFILIATE_PRODUCT_SEEDS.map((product) => ({
  ...product,
  thumbnailUrl: buildThumbnailDataUrl(product.thumbnailLabel, product.thumbnailColors[0], product.thumbnailColors[1]),
}));

const AFFILIATE_PRODUCT_MAP = new Map(AFFILIATE_PRODUCTS.map((product) => [product.id, product]));

function normalizeQuery(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function scoreAffiliateProduct(product: AffiliateProduct, normalizedQuery: string, terms: string[]) {
  const haystack = `${product.name} ${product.description} ${product.provider} ${product.searchTerms.join(" ")}`.toLowerCase();
  let score = 0;

  if (product.name.toLowerCase().includes(normalizedQuery)) {
    score += 14;
  }

  if (product.provider.toLowerCase().includes(normalizedQuery)) {
    score += 3;
  }

  for (const term of terms) {
    if (!term) {
      continue;
    }

    if (product.name.toLowerCase().startsWith(term)) {
      score += 6;
    } else if (product.name.toLowerCase().includes(term)) {
      score += 4;
    }

    if (haystack.includes(term)) {
      score += 2;
    }
  }

  return score;
}

function uniqueProductIds(productIds: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const productId of productIds) {
    const normalizedId = productId.trim().toLowerCase();
    if (!normalizedId || seen.has(normalizedId) || !AFFILIATE_PRODUCT_MAP.has(normalizedId)) {
      continue;
    }

    seen.add(normalizedId);
    output.push(normalizedId);
  }

  return output;
}

export function getAffiliateProductById(productId: string) {
  return AFFILIATE_PRODUCT_MAP.get(productId.trim().toLowerCase()) ?? null;
}

export function searchAffiliateProducts(query: string, limit = 6) {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return [] as AffiliateProduct[];
  }

  const terms = normalizedQuery.split(" ");

  return AFFILIATE_PRODUCTS
    .map((product) => ({
      product,
      score: scoreAffiliateProduct(product, normalizedQuery, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.product.name.localeCompare(right.product.name);
    })
    .slice(0, limit)
    .map((entry) => entry.product);
}

export function extractAffiliateProductIds(content: string | null | undefined) {
  if (typeof content !== "string" || !content) {
    return [] as string[];
  }

  const productIds: string[] = [];
  const seen = new Set<string>();
  AFFILIATE_PRODUCT_TOKEN_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = AFFILIATE_PRODUCT_TOKEN_PATTERN.exec(content)) !== null) {
    const productId = match[1]?.trim().toLowerCase();
    if (!productId || seen.has(productId) || !AFFILIATE_PRODUCT_MAP.has(productId)) {
      continue;
    }

    seen.add(productId);
    productIds.push(productId);
  }

  return productIds;
}

export function getAffiliateProductsForPostContent(content: string | null | undefined) {
  return extractAffiliateProductIds(content)
    .map((productId) => AFFILIATE_PRODUCT_MAP.get(productId))
    .filter((product): product is AffiliateProduct => Boolean(product));
}

export function stripAffiliateProductTokens(content: string | null | undefined) {
  if (typeof content !== "string" || !content) {
    return "";
  }

  AFFILIATE_PRODUCT_TOKEN_PATTERN.lastIndex = 0;

  return content
    .replace(AFFILIATE_PRODUCT_TOKEN_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildPostContentWithAffiliateProducts(content: string, productIds: string[]) {
  const visibleContent = stripAffiliateProductTokens(content).trim();
  const nextProductIds = uniqueProductIds(productIds);

  if (!nextProductIds.length) {
    return visibleContent;
  }

  const tokens = nextProductIds.map((productId) => `[[affiliate-product:${productId}]]`).join("\n");
  return `${visibleContent}\n${tokens}`.trim();
}
