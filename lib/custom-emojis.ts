const CUSTOM_EMOJI_TOKEN_PATTERN = /\[\[ce\|([^\]]+)\]\]/g;
const CUSTOM_EMOJI_ASSET_PATTERN = /^\/emojis\/.+\.(png|gif)$/i;

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

  if (CUSTOM_EMOJI_ASSET_PATTERN.test(trimmed)) {
    const [pathPart] = trimmed.split(/[?#]/, 1);
    return decodeEmojiValue(pathPart);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
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
  return Boolean(normalizeCustomEmojiUrl(value)?.match(CUSTOM_EMOJI_ASSET_PATTERN));
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
