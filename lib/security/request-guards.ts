import { NextRequest } from "next/server";

type RateLimitRecord = {
  count: number;
  firstAt: number;
  blockedUntil: number;
};

const rateLimitStore = new Map<string, RateLimitRecord>();

export function getClientIp(request: NextRequest | Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const fallback = request.headers.get("cf-connecting-ip")?.trim();
  return forwarded || realIp || fallback || "unknown";
}

export function applyRateLimit(options: {
  key: string;
  windowMs: number;
  max: number;
  blockMs?: number;
}) {
  const now = Date.now();
  const existing = rateLimitStore.get(options.key);

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000),
    };
  }

  if (!existing || now - existing.firstAt > options.windowMs) {
    rateLimitStore.set(options.key, {
      count: 1,
      firstAt: now,
      blockedUntil: 0,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > options.max) {
    existing.blockedUntil = now + (options.blockMs ?? options.windowMs);
    rateLimitStore.set(options.key, existing);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000),
    };
  }

  rateLimitStore.set(options.key, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}

const SQLI_PATTERN = /(\bunion\b\s+\bselect\b|\bdrop\b\s+\btable\b|\bor\b\s+1=1|--|\/\*|\*\/|\bpg_sleep\b|\binformation_schema\b)/i;
const XSS_PATTERN = /(<\s*script|javascript:|onerror\s*=|onload\s*=|<\s*iframe|<\s*img[^>]+onerror)/i;

export function hasSuspiciousInput(value: string) {
  return SQLI_PATTERN.test(value) || XSS_PATTERN.test(value);
}

export function sanitizeUserText(value: string, maxLength = 5000) {
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script>/gi, "")
    .replace(/<\s*\/??\s*iframe[^>]*>/gi, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
