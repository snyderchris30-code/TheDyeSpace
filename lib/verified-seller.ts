export const VERIFIED_SELLER_CONTACT_REQUEST_STATUSES = ["pending", "approved", "denied"] as const;

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