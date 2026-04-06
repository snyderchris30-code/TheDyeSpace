export function normalizePostImageUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
        }
      } catch {
        // Keep fallback behavior for malformed JSON strings.
      }
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return [trimmed];
    }
  }

  return [];
}
