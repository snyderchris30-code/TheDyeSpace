"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Heart, Smile } from "lucide-react";

import CustomEmojiImage from "@/app/CustomEmojiImage";
import { buildCustomEmojiAsset, encodeCustomEmojiToken, type CustomEmojiAsset } from "@/lib/custom-emojis";

type EmojiPickerProps = {
  onSelect: (emojiOrToken: string) => void;
  className?: string;
  mode?: "text" | "reaction";
  disabled?: boolean;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  align?: "left" | "right";
  closeOnSelect?: boolean;
  triggerContent?: ReactNode;
};

type EmojiResponse = {
  emojis?: Array<Partial<CustomEmojiAsset>>;
};

let cachedEmojiAssets: CustomEmojiAsset[] | null = null;
let emojiAssetsRequest: Promise<CustomEmojiAsset[]> | null = null;

async function loadEmojiAssets() {
  if (cachedEmojiAssets) {
    return cachedEmojiAssets;
  }

  if (!emojiAssetsRequest) {
    emojiAssetsRequest = fetch("/api/emojis", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as EmojiResponse;
        if (!response.ok) {
          return [];
        }

        const assets = Array.isArray(body.emojis)
          ? body.emojis
              .map((emoji) => (typeof emoji?.url === "string" ? buildCustomEmojiAsset(emoji.url) : null))
              .filter((emoji): emoji is CustomEmojiAsset => Boolean(emoji))
          : [];

        cachedEmojiAssets = assets;
        return assets;
      })
      .finally(() => {
        emojiAssetsRequest = null;
      });
  }

  return emojiAssetsRequest;
}

export default function EmojiPicker({
  onSelect,
  className,
  mode = "text",
  disabled = false,
  triggerLabel,
  triggerAriaLabel,
  triggerClassName,
  align = "right",
  closeOnSelect = mode === "reaction",
  triggerContent,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [customEmojiAssets, setCustomEmojiAssets] = useState<CustomEmojiAsset[]>(cachedEmojiAssets || []);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    void loadEmojiAssets().then((assets) => {
      if (active) {
        setCustomEmojiAssets(assets);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  const defaultLabel = triggerLabel || (mode === "reaction" ? "React" : "Add emoji");
  const Icon = mode === "reaction" ? Heart : Smile;
  const panelPositionClass = align === "left" ? "left-0" : "right-0";

  const handleSelect = (emoji: CustomEmojiAsset) => {
    onSelect(mode === "reaction" ? emoji.url : encodeCustomEmojiToken(emoji.url));
    if (closeOnSelect) {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className || ""}`}>
      <button
        type="button"
        className={triggerClassName || "inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-label={triggerAriaLabel || defaultLabel}
      >
        {triggerContent ? (
          triggerContent
        ) : (
          <>
            <Icon className="h-4 w-4 text-cyan-200" />
            <span>{open ? "Hide emojis" : defaultLabel}</span>
          </>
        )}
      </button>

      {open ? (
        <div className={`absolute top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-3xl border border-cyan-300/20 bg-slate-950/95 p-3 shadow-[0_20px_60px_rgba(8,15,30,0.35)] ${panelPositionClass}`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Custom emojis</p>
            <span className="text-xs text-cyan-100/60">{customEmojiAssets.length} loaded</span>
          </div>

          {customEmojiAssets.length > 0 ? (
            <div className="grid max-h-[18rem] grid-cols-6 gap-2 overflow-y-auto rounded-3xl border border-cyan-300/10 bg-black/20 p-2 sm:grid-cols-7">
              {customEmojiAssets.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  className="rounded-2xl border border-cyan-300/10 bg-black/30 p-2 transition hover:border-cyan-300/40 hover:bg-cyan-900/60"
                  onClick={() => handleSelect(emoji)}
                  title={emoji.name}
                >
                  <CustomEmojiImage src={emoji.url} alt={emoji.name} className="h-8 w-8 rounded-xl object-contain" title={emoji.name} />
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-3xl border border-cyan-300/10 bg-black/20 px-3 py-3 text-xs text-cyan-100/70">
              No custom emojis were found in public/emojis.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
