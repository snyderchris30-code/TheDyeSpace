const CUSTOM_EMOJI_TOKEN_PATTERN = /\[\[ce\|([^\]]+)\]\]/g;

export const HIPPIE_UNICODE_EMOJIS = ["🌿", "🍄", "🌀", "☮️", "🌈", "🔥", "🌙", "💚", "✨", "💫"];

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

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }

      const normalized = parsed.toString();
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      output.push(normalized);

      if (output.length >= maxItems) {
        break;
      }
    } catch {
      // Ignore invalid URLs in imported lists.
    }
  }

  return output;
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
