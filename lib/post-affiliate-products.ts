export type AffiliateProduct = {
  id: string;
  name: string;
  description: string;
  provider: string;
  affiliateUrl: string;
  thumbnailUrl: string;
  category: "shirt" | "dye" | "supply" | "kit";
  searchTerms: string[];
  shirtTypes?: string[];
  materials?: string[];
  dyeColors?: string[];
};

type AffiliateProductSeed = Omit<AffiliateProduct, "thumbnailUrl"> & {
  thumbnailLabel: string;
  thumbnailColors: [string, string];
};

export type AffiliateProductSearchOptions = {
  query?: string;
  shirtType?: string;
  material?: string;
  dyeColors?: string[];
  limit?: number;
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
    category: "kit",
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
    category: "dye",
    thumbnailLabel: "DYE",
    thumbnailColors: ["#c026d3", "#0891b2"],
    searchTerms: ["procion dye", "fiber reactive dye", "mx dye", "dharma dye", "powder dye"],
    dyeColors: ["bright green", "black", "aquamarine", "fuchsia", "turquoise", "lemon yellow"],
  },
  {
    id: "amazon-cotton-shirt-pack",
    name: "Cotton Shirt Blank Pack",
    description: "Soft cotton blanks that work well for ice dye, spiral dye, and everyday practice runs.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=cotton+shirt+blank&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "SHIRT",
    thumbnailColors: ["#7c3aed", "#ec4899"],
    searchTerms: ["cotton shirt", "blank tee", "blank shirt", "white shirt", "cotton blank"],
    shirtTypes: ["t-shirt", "tee"],
    materials: ["100% cotton", "cotton"],
  },
  {
    id: "dharma-soda-ash-fixative",
    name: "Soda Ash Dye Fixative",
    description: "Pre-soak staple for locking color into fiber-reactive projects.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=soda+ash",
    category: "supply",
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
    category: "supply",
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
    category: "supply",
    thumbnailLabel: "SINEW",
    thumbnailColors: ["#1d4ed8", "#14b8a6"],
    searchTerms: ["waxed sinew", "resist string", "geode supplies", "binding string", "sinew"],
  },
  {
    id: "amazon-cotton-hoodie-blank",
    name: "Cotton Blend Hoodie Blank",
    description: "Heavyweight hoodie blank suited for larger dye layouts and colder-weather drops.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=cotton+hoodie+blank&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "HOOD",
    thumbnailColors: ["#1e3a8a", "#0f766e"],
    searchTerms: ["hoodie", "hooded sweatshirt", "blank hoodie", "pullover hoodie"],
    shirtTypes: ["hoodie"],
    materials: ["80% cotton 20% polyester", "cotton blend", "cotton fleece"],
  },
  {
    id: "amazon-long-sleeve-blank",
    name: "Long Sleeve Blank Tee",
    description: "Long sleeve blank for layered color placements and cooler market drops.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=long+sleeve+blank+shirt&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "LONG",
    thumbnailColors: ["#0f766e", "#6d28d9"],
    searchTerms: ["long sleeve", "long sleeve tee", "long sleeve shirt", "blank long sleeve"],
    shirtTypes: ["long sleeve"],
    materials: ["100% cotton", "cotton"],
  },
  {
    id: "amazon-racerback-tank-blank",
    name: "Racerback Tank Blank",
    description: "Soft tank blank that works well for lightweight summer dye pieces.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=tank+top+blank+cotton&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "TANK",
    thumbnailColors: ["#db2777", "#7c3aed"],
    searchTerms: ["tank top", "tank", "blank tank", "racerback tank"],
    shirtTypes: ["tank top", "tank"],
    materials: ["95% cotton 5% spandex", "cotton spandex", "100% cotton"],
  },
  {
    id: "amazon-crewneck-sweatshirt-blank",
    name: "Crewneck Sweatshirt Blank",
    description: "Roomy crewneck blank for reverse dye, washes, and seasonal tie-dye collections.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=crewneck+sweatshirt+blank&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "CREW",
    thumbnailColors: ["#9333ea", "#1d4ed8"],
    searchTerms: ["crewneck", "crewneck sweatshirt", "blank sweatshirt", "crew"],
    shirtTypes: ["crewneck"],
    materials: ["80% cotton 20% polyester", "cotton blend", "fleece"],
  },
  {
    id: "amazon-cotton-jeans-blank",
    name: "Cotton Denim Jeans",
    description: "Cotton-rich denim base for over-dyeing, bleach effects, and stitched resist looks.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=cotton+denim+jeans&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "JEANS",
    thumbnailColors: ["#1d4ed8", "#0f172a"],
    searchTerms: ["jeans", "denim", "cotton jeans", "denim pants"],
    shirtTypes: ["jeans"],
    materials: ["100% cotton denim", "cotton denim", "98% cotton 2% spandex"],
  },
  {
    id: "amazon-cotton-dress-blank",
    name: "Cotton Dress Blank",
    description: "Flowy dress blank for festival dye patterns and bright boutique drops.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=cotton+dress+blank&tag=thedyespace-20",
    category: "shirt",
    thumbnailLabel: "DRESS",
    thumbnailColors: ["#be185d", "#fb7185"],
    searchTerms: ["dress", "blank dress", "cotton dress", "maxi dress"],
    shirtTypes: ["dress"],
    materials: ["100% cotton", "95% cotton 5% spandex", "cotton jersey"],
  },
  {
    id: "dharma-procion-bright-green",
    name: "Procion MX Bright Green",
    description: "Punchy green for neon geodes, spirals, and high-contrast gradients.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=procion+mx+bright+green",
    category: "dye",
    thumbnailLabel: "GREEN",
    thumbnailColors: ["#22c55e", "#15803d"],
    searchTerms: ["procion mx bright green", "bright green", "green dye", "procion bright green"],
    dyeColors: ["bright green", "green"],
  },
  {
    id: "dharma-procion-jet-black",
    name: "Procion MX Jet Black",
    description: "Deep black staple for outlines, reverse dye work, and high-contrast palettes.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=procion+mx+jet+black",
    category: "dye",
    thumbnailLabel: "BLACK",
    thumbnailColors: ["#111827", "#374151"],
    searchTerms: ["procion mx black", "jet black", "black dye", "procion black"],
    dyeColors: ["black", "jet black"],
  },
  {
    id: "dharma-procion-aquamarine",
    name: "Procion MX Aquamarine",
    description: "Cool aqua tone that plays well with blues, purples, and tropical palettes.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=procion+mx+aquamarine",
    category: "dye",
    thumbnailLabel: "AQUA",
    thumbnailColors: ["#06b6d4", "#0ea5e9"],
    searchTerms: ["procion mx aquamarine", "aquamarine", "aqua dye", "turquoise aqua"],
    dyeColors: ["aquamarine", "aqua", "turquoise"],
  },
  {
    id: "dharma-procion-fuchsia",
    name: "Procion MX Fuchsia",
    description: "Hot pink workhorse for rainbows, florals, and psychedelic blends.",
    provider: "Dharma Trading",
    affiliateUrl: "https://www.dharmatrading.com/search?q=procion+mx+fuchsia",
    category: "dye",
    thumbnailLabel: "PINK",
    thumbnailColors: ["#ec4899", "#be185d"],
    searchTerms: ["procion mx fuchsia", "fuchsia", "pink dye", "hot pink"],
    dyeColors: ["fuchsia", "hot pink", "pink"],
  },
  {
    id: "amazon-nitrile-gloves-box",
    name: "Nitrile Gloves Box",
    description: "Disposable glove box for prep, batching, and cleaner dye sessions.",
    provider: "Amazon",
    affiliateUrl: "https://www.amazon.com/s?k=nitrile+gloves+for+tie+dye&tag=thedyespace-20",
    category: "supply",
    thumbnailLabel: "GLOVE",
    thumbnailColors: ["#0284c7", "#0f766e"],
    searchTerms: ["gloves", "nitrile gloves", "tie dye gloves", "prep gloves"],
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

function normalizeSearchTerms(value: string) {
  const normalized = normalizeQuery(value);
  return normalized ? normalized.split(" ") : [];
}

function normalizedIncludes(values: string[] | undefined, target: string) {
  if (!values?.length || !target) {
    return false;
  }

  const normalizedTarget = normalizeQuery(target);
  return values.some((value) => {
    const normalizedValue = normalizeQuery(value);
    return normalizedValue === normalizedTarget || normalizedValue.includes(normalizedTarget) || normalizedTarget.includes(normalizedValue);
  });
}

function tokenizeCommaSeparatedInput(value: string) {
  return value
    .split(",")
    .map((item) => normalizeQuery(item))
    .filter(Boolean);
}

function scoreAffiliateProduct(
  product: AffiliateProduct,
  normalizedQuery: string,
  terms: string[],
  shirtType: string,
  material: string,
  dyeColors: string[]
) {
  const haystack = `${product.name} ${product.description} ${product.provider} ${product.searchTerms.join(" ")}`.toLowerCase();
  let score = 0;

  if (normalizedQuery && product.name.toLowerCase().includes(normalizedQuery)) {
    score += 14;
  }

  if (normalizedQuery && product.provider.toLowerCase().includes(normalizedQuery)) {
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

  if (shirtType) {
    if (product.category === "shirt" && normalizedIncludes(product.shirtTypes, shirtType)) {
      score += 16;
    } else if (haystack.includes(shirtType)) {
      score += 5;
    }
  }

  if (material) {
    if (product.category === "shirt" && normalizedIncludes(product.materials, material)) {
      score += 14;
    } else if (haystack.includes(material)) {
      score += 4;
    }

    const materialTerms = normalizeSearchTerms(material);
    for (const term of materialTerms) {
      if (term.length < 3) {
        continue;
      }

      if (haystack.includes(term)) {
        score += 2;
      }
    }
  }

  for (const dyeColor of dyeColors) {
    if (product.category === "dye" && normalizedIncludes(product.dyeColors, dyeColor)) {
      score += 18;
      continue;
    }

    if (haystack.includes(dyeColor)) {
      score += 5;
    }
  }

  if ((shirtType || material || dyeColors.length) && (product.category === "kit" || product.category === "supply")) {
    score += 2;
  }

  if (!normalizedQuery && (shirtType || material || dyeColors.length) && score > 0) {
    score += 1;
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

export function searchAffiliateProducts(options: AffiliateProductSearchOptions | string, limitFallback = 6) {
  const query = typeof options === "string" ? options : options.query || "";
  const shirtType = typeof options === "string" ? "" : normalizeQuery(options.shirtType || "");
  const material = typeof options === "string" ? "" : normalizeQuery(options.material || "");
  const dyeColors = typeof options === "string" ? [] : (options.dyeColors || []).map((color) => normalizeQuery(color)).filter(Boolean);
  const limit = typeof options === "string" ? limitFallback : options.limit || limitFallback;
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery && !shirtType && !material && !dyeColors.length) {
    return [] as AffiliateProduct[];
  }

  const terms = normalizedQuery.split(" ");

  return AFFILIATE_PRODUCTS
    .map((product) => ({
      product,
      score: scoreAffiliateProduct(product, normalizedQuery, terms, shirtType, material, dyeColors),
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

export function parseDyeColors(value: string) {
  return tokenizeCommaSeparatedInput(value);
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
