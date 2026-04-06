"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeCustomEmojiToken, HIPPIE_UNICODE_EMOJIS, normalizeCustomEmojiUrls } from "@/lib/custom-emojis";

type EmojiPickerProps = {
  onSelect: (emojiOrToken: string) => void;
  className?: string;
};

type EmojiResponse = {
  emojiUrls?: string[];
};

export default function EmojiPicker({ onSelect, className }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [customEmojiUrls, setCustomEmojiUrls] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    const loadCustomEmojis = async () => {
      try {
        const response = await fetch("/api/admin/custom-emojis", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as EmojiResponse;
        if (!response.ok || !active) {
          return;
        }

        setCustomEmojiUrls(normalizeCustomEmojiUrls(body.emojiUrls || [], 200));
      } catch {
        // Keep picker usable without networked custom emojis.
      }
    };

    void loadCustomEmojis();
    return () => {
      active = false;
    };
  }, []);

  const customEmojiLabel = useMemo(
    () => `${customEmojiUrls.length} custom emoji${customEmojiUrls.length === 1 ? "" : "s"}`,
    [customEmojiUrls.length]
  );

  return (
    <div className={className}>
      <button
        type="button"
        className="rounded-full border border-cyan-300/25 bg-black/25 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-black/40"
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "Hide Emoji Picker" : "Emoji Picker"}
      </button>

      {open ? (
        <div className="mt-2 rounded-2xl border border-cyan-300/20 bg-slate-950/90 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Hippie Vibes</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {HIPPIE_UNICODE_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-full border border-cyan-300/15 bg-black/30 px-2 py-1 text-lg hover:scale-105"
                onClick={() => onSelect(emoji)}
                title={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Custom Emojis</p>
          {customEmojiUrls.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {customEmojiUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  className="rounded-full border border-cyan-300/15 bg-black/30 p-1 hover:scale-105"
                  onClick={() => onSelect(encodeCustomEmojiToken(url))}
                  title="Insert custom emoji"
                >
                  <img src={url} alt="custom emoji" className="h-6 w-6 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-cyan-100/70">No custom emoji imported yet. {customEmojiLabel}.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
