import type { SellerProduct } from "@/types/database";

export const VERIFIED_SELLER_CONTACT_REQUEST_STATUSES = ["pending", "approved", "denied"] as const;

const MAX_SELLER_PRODUCTS = 24;
const MAX_SELLER_PRODUCT_PHOTOS = 6;

export type VerifiedSellerContactRequestStatus = (typeof VERIFIED_SELLER_CONTACT_REQUEST_STATUSES)[number];

export type SellerContactSettings = {
  seller_background_url?: string | null;
  seller_contact_email?: string | null;
  seller_contact_phone?: string | null;
  seller_contact_link?: string | null;
  seller_contact_message?: string | null;
};

export type SmokeLoungeAccessProfile = {
  role?: string | null;
  verified_badge?: boolean | null;
  smoke_room_2_invited?: boolean | null;
};

function normalizeOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeSellerPrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(2);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/[^0-9.]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed.toFixed(2);
}

function normalizeSellerProductPhotos(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueUrls = new Set<string>();
  for (const candidate of value) {
    const url = normalizeOptionalString(candidate, 2048);
    if (!url) {
      continue;
    }

    uniqueUrls.add(url);
    if (uniqueUrls.size >= MAX_SELLER_PRODUCT_PHOTOS) {
      break;
    }
  }

  return Array.from(uniqueUrls);
}

export function normalizeSellerProducts(value: unknown): SellerProduct[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const products: SellerProduct[] = [];
  const usedIds = new Set<string>();

  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const title = normalizeOptionalString((candidate as SellerProduct).title, 120);
    if (!title) {
      continue;
    }

    const rawId = normalizeOptionalString((candidate as SellerProduct).id, 80) || `seller-product-${index + 1}`;
    let id = rawId;
    while (usedIds.has(id)) {
      id = `${rawId}-${products.length + 1}`;
    }

    usedIds.add(id);
    products.push({
      id,
      title,
      price: normalizeSellerPrice((candidate as SellerProduct).price),
      description: normalizeOptionalString((candidate as SellerProduct).description, 1000),
      photo_urls: normalizeSellerProductPhotos((candidate as SellerProduct).photo_urls),
    });

    if (products.length >= MAX_SELLER_PRODUCTS) {
      break;
    }
  }

  return products;
}

export function resolveSellerContactSettings(settings?: Partial<SellerContactSettings> | null) {
  return {
    seller_background_url: normalizeOptionalString(settings?.seller_background_url, 2048),
    seller_contact_email: normalizeOptionalString(settings?.seller_contact_email, 200),
    seller_contact_phone: normalizeOptionalString(settings?.seller_contact_phone, 120),
    seller_contact_link: normalizeOptionalString(settings?.seller_contact_link, 400),
    seller_contact_message: normalizeOptionalString(settings?.seller_contact_message, 600),
  } satisfies Required<SellerContactSettings>;
}

export function hasSellerContactDetails(settings?: Partial<SellerContactSettings> | null) {
  const resolved = resolveSellerContactSettings(settings);
  return Boolean(
    resolved.seller_contact_email ||
      resolved.seller_contact_phone ||
      resolved.seller_contact_link ||
      resolved.seller_contact_message
  );
}

export function formatSellerContactDetails(settings?: Partial<SellerContactSettings> | null) {
  const resolved = resolveSellerContactSettings(settings);
  const lines: string[] = [];

  if (resolved.seller_contact_message) {
    lines.push(`Message: ${resolved.seller_contact_message}`);
  }

  if (resolved.seller_contact_email) {
    lines.push(`Email: ${resolved.seller_contact_email}`);
  }

  if (resolved.seller_contact_phone) {
    lines.push(`Phone: ${resolved.seller_contact_phone}`);
  }

  if (resolved.seller_contact_link) {
    lines.push(`Instagram / Website: ${resolved.seller_contact_link}`);
  }

  return lines.join("\n");
}

export function canAccessSmokeLounge(profile?: SmokeLoungeAccessProfile | null) {
  return profile?.role === "admin" || (profile?.verified_badge === true && profile?.smoke_room_2_invited === true);
}