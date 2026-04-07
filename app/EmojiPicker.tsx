"use client";

import { useEffect, useMemo, useState } from "react";
import { Smile } from "lucide-react";
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
        className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-slate-900"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Smile className="h-4 w-4 text-cyan-200" />
        <span>{open ? "Hide emojis" : "Add emoji"}</span>
      </button>

      {open ? (
        <div className="mt-2 rounded-3xl border border-cyan-300/20 bg-slate-950/95 p-3 shadow-[0_20px_60px_rgba(8,15,30,0.35)]">
          <div className="space-y-3">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Default emojis</p>
                <span className="text-xs text-cyan-100/60">Tap to insert</span>
              </div>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                {HIPPIE_UNICODE_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="aspect-square rounded-2xl border border-cyan-300/15 bg-black/30 text-lg transition hover:border-cyan-300/50 hover:bg-cyan-900/60"
                    onClick={() => onSelect(emoji)}
                    title={`Insert ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Custom emoji packs</p>
                <span className="text-xs text-cyan-100/60">Loaded from admin settings</span>
              </div>
              {customEmojiUrls.length > 0 ? (
                <div className="grid max-h-[18rem] grid-cols-6 gap-2 overflow-y-auto rounded-3xl border border-cyan-300/10 bg-black/20 p-2">
                  {customEmojiUrls.map((url) => (
                    <button
                      key={url}
                      type="button"
                      className="rounded-2xl border border-cyan-300/10 bg-black/30 p-2 transition hover:border-cyan-300/40 hover:bg-cyan-900/60"
                      onClick={() => onSelect(encodeCustomEmojiToken(url))}
                      title="Insert custom emoji"
                    >
                      <img src={url} alt="custom emoji" className="h-8 w-8 rounded-xl object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-3xl border border-cyan-300/10 bg-black/20 px-3 py-3 text-xs text-cyan-100/70">
                  No custom emojis have been added yet. {customEmojiLabel}.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
