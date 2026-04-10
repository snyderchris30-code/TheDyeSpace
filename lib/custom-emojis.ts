const CUSTOM_EMOJI_TOKEN_PATTERN = /\[\[ce\|([^\]]+)\]\]/g;
const CUSTOM_EMOJI_ASSET_PATTERN = /^(?:\/emojis\/)?[^/]+\.(png|gif)$/i;

export type CustomEmojiAsset = {
  id: string;
  name: string;
  url: string;
  fileName: string;
};

function decodeEmojiValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeEmojiFileName(fileName: string) {
  const withoutExtension = fileName.replace(/\.(png|gif)$/i, "");
  const withoutPrefix = withoutExtension.replace(/^\d+[-_]?/, "");
  const collapsed = withoutPrefix.replace(/[-_]+/g, " ").trim();
  return collapsed || withoutExtension || "emoji";
}

export function normalizeCustomEmojiUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const [pathPart] = trimmed.split(/[?#]/, 1);
  const decoded = decodeEmojiValue(pathPart);
  const normalized = decoded.replace(/^\/emojis\//i, "").trim();

  if (CUSTOM_EMOJI_ASSET_PATTERN.test(normalized)) {
    return normalized;
  }

  try {
    const parsed = new URL(trimmed);
    const relativePath = parsed.pathname.replace(/^\/emojis\//i, "").trim();
    if (CUSTOM_EMOJI_ASSET_PATTERN.test(relativePath)) {
      return relativePath;
    }
  } catch {
    // ignore invalid URLs
  }

  return null;
}

export function normalizeCustomEmojiStorageValue(value: unknown) {
  const normalized = normalizeCustomEmojiUrl(value);
  return normalized ? `/emojis/${normalized}` : null;
}

export function buildCustomEmojiSrc(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return trimmedValue;
  }

  if (trimmedValue.startsWith("/emojis/")) {
    const innerValue = trimmedValue.replace(/^\/emojis\//i, "");
    return `/emojis/${innerValue
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  if (CUSTOM_EMOJI_ASSET_PATTERN.test(trimmedValue)) {
    return `/emojis/${encodeURIComponent(trimmedValue)}`;
  }

  try {
    const parsed = new URL(trimmedValue);
    return trimmedValue;
  } catch {
    return trimmedValue;
  }
}

export function normalizeCustomEmojiUrls(value: unknown, maxItems = 200) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/) 
      : [];

  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of rawValues) {
    if (typeof raw !== "string") {
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = normalizeCustomEmojiUrl(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);

    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
}

export function isCustomEmojiReaction(value: unknown): value is string {
  const normalized = normalizeCustomEmojiUrl(value);
  return Boolean(normalized && CUSTOM_EMOJI_ASSET_PATTERN.test(normalized));
}

export function buildCustomEmojiAsset(url: string): CustomEmojiAsset {
  const normalizedUrl = normalizeCustomEmojiUrl(url) || url;
  const decodedUrl = decodeEmojiValue(normalizedUrl);
  const fileName = decodedUrl.split("/").pop() || decodedUrl;
  const name = normalizeEmojiFileName(fileName);

  return {
    id: decodedUrl,
    name,
    url: decodedUrl,
    fileName,
  };
}

export function encodeCustomEmojiToken(url: string) {
  return `[[ce|${url}]]`;
}

export function appendEmojiToText(currentText: string, emojiOrToken: string) {
  const current = currentText || "";
  const next = emojiOrToken.trim();
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  const needsSpace = !/\s$/.test(current);
  return `${current}${needsSpace ? " " : ""}${next}`;
}

export type EmojiTextSegment =
  | { type: "text"; value: string }
  | { type: "emoji"; url: string };

export function parseEmojiTextSegments(text: string): EmojiTextSegment[] {
  const source = text || "";
  if (!source) {
    return [{ type: "text", value: "" }];
  }

  const segments: EmojiTextSegment[] = [];
  let lastIndex = 0;

  source.replace(CUSTOM_EMOJI_TOKEN_PATTERN, (match, url, offset: number) => {
    if (offset > lastIndex) {
      segments.push({ type: "text", value: source.slice(lastIndex, offset) });
    }

    const normalized = normalizeCustomEmojiUrls([url], 1)[0];
    if (normalized) {
      segments.push({ type: "emoji", url: normalized });
    } else {
      segments.push({ type: "text", value: match });
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < source.length) {
    segments.push({ type: "text", value: source.slice(lastIndex) });
  }

  if (!segments.length) {
    return [{ type: "text", value: source }];
  }

  return segments;
}
