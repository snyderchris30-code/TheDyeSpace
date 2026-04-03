export function isEmailLike(value: string | null | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function sanitizeUsernameInput(value: string | null | undefined) {
  if (!value) return "";

  const emailSafeValue = isEmailLike(value) ? value.split("@")[0] : value;

  return emailSafeValue
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

export function resolveProfileUsername(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const sanitized = sanitizeUsernameInput(candidate);
    if (sanitized.length >= 3) {
      return sanitized;
    }
  }

  return "dyespace-user";
}