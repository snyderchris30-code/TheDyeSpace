"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Heart, Smile } from "lucide-react";

import CustomEmojiImage from "@/app/CustomEmojiImage";
import { buildCustomEmojiAsset, encodeCustomEmojiToken, type CustomEmojiAsset } from "@/lib/custom-emojis";

type EmojiPickerProps = {
  onSelect: (emojiOrToken: string) => void;
  className?: string;
  mode?: "text" | "reaction";
  reactionLayout?: "panel" | "floating-inline";
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
let cachedEmojiAssetsLoadedAt = 0;

const EMOJI_ASSET_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadEmojiAssets(forceReload = false) {
  const cacheIsFresh = cachedEmojiAssets && Date.now() - cachedEmojiAssetsLoadedAt < EMOJI_ASSET_CACHE_TTL_MS;
  if (cacheIsFresh && !forceReload) {
    return cachedEmojiAssets ?? [];
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
        cachedEmojiAssetsLoadedAt = Date.now();
        return assets;
      })
      .finally(() => {
        emojiAssetsRequest = null;
      });
  }

  return emojiAssetsRequest ?? Promise.resolve([] as CustomEmojiAsset[]);
}

const RECENT_REACTIONS_STORAGE_KEY = "recently-used-emoji-reactions";
const RECENT_REACTIONS_LIMIT = 10;
const REACTION_BATCH_SIZE = 30;

function readStoredRecentlyUsedReactions() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  const stored = window.localStorage.getItem(RECENT_REACTIONS_STORAGE_KEY);
  if (!stored) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(stored) as string[];
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "string");
    }
  } catch {
    // ignore invalid storage data
  }

  return [] as string[];
}

export default function EmojiPicker({
  onSelect,
  className,
  mode = "text",
  reactionLayout = "panel",
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
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>([]);
  const [visibleEmojiCount, setVisibleEmojiCount] = useState(REACTION_BATCH_SIZE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isFloatingInlineReaction = mode === "reaction" && reactionLayout === "floating-inline";

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    if (mode === "reaction") {
      setRecentlyUsed(readStoredRecentlyUsedReactions());
      setVisibleEmojiCount(REACTION_BATCH_SIZE);
    }

    void loadEmojiAssets().then((assets) => {
      if (active) {
        setCustomEmojiAssets(assets);
      }
    });

    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (mode !== "reaction") {
      return;
    }

    setRecentlyUsed(readStoredRecentlyUsedReactions());
  }, [mode]);

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
  const rootClassName = [
    "relative",
    isFloatingInlineReaction ? (open ? "min-w-0 w-full basis-full" : "min-w-0 w-auto shrink-0") : "w-full",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  const updateRecentlyUsed = (emojiFileName: string) => {
    if (mode !== "reaction") {
      return;
    }

    setRecentlyUsed((previous) => {
      const next = [emojiFileName, ...previous.filter((item) => item !== emojiFileName)].slice(0, RECENT_REACTIONS_LIMIT);
      window.localStorage.setItem(RECENT_REACTIONS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleSelect = (emoji: CustomEmojiAsset) => {
    if (mode === "reaction") {
      updateRecentlyUsed(emoji.fileName);
    }

    onSelect(mode === "reaction" ? emoji.fileName : encodeCustomEmojiToken(emoji.url));
    if (closeOnSelect) {
      setOpen(false);
    }
  };

  const recentlyUsedAssets = recentlyUsed
    .map((fileName) => customEmojiAssets.find((asset) => asset.fileName === fileName))
    .filter((asset): asset is CustomEmojiAsset => Boolean(asset));
  const visibleCustomEmojiAssets = isFloatingInlineReaction ? customEmojiAssets.slice(0, visibleEmojiCount) : customEmojiAssets;
  const canLoadMore = isFloatingInlineReaction && visibleCustomEmojiAssets.length < customEmojiAssets.length;

  return (
    <div ref={rootRef} className={rootClassName}>
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
        isFloatingInlineReaction ? (
          <div className="mt-3 flex w-full flex-col gap-5 px-1 pb-1">
            {recentlyUsedAssets.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="pl-1 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Recently Used</p>
                  <span className="text-[11px] text-cyan-100/55">{recentlyUsedAssets.length}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                  {recentlyUsedAssets.map((emoji) => (
                    <button
                      key={`recent-${emoji.id}`}
                      type="button"
                      className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] transition hover:bg-cyan-400/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70"
                      onClick={() => handleSelect(emoji)}
                      title={emoji.name}
                    >
                      <CustomEmojiImage src={emoji.url} alt={emoji.name} className="h-8 w-8 object-contain" title={emoji.name} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="pl-1 text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">All Emojis</p>
                <span className="text-[11px] text-cyan-100/55">
                  {visibleCustomEmojiAssets.length} of {customEmojiAssets.length}
                </span>
              </div>

              {customEmojiAssets.length > 0 ? (
                <>
                  <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6 sm:gap-3 lg:grid-cols-7">
                    {visibleCustomEmojiAssets.map((emoji) => (
                      <button
                        key={emoji.id}
                        type="button"
                        className="flex min-h-12 items-center justify-center rounded-2xl bg-white/[0.04] p-2 transition hover:bg-cyan-400/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70"
                        onClick={() => handleSelect(emoji)}
                        title={emoji.name}
                      >
                        <CustomEmojiImage src={emoji.url} alt={emoji.name} className="h-8 w-8 object-contain" title={emoji.name} />
                      </button>
                    ))}
                  </div>

                  {canLoadMore ? (
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-center rounded-full bg-cyan-300/10 px-4 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/15 sm:w-auto"
                      onClick={() => {
                        setVisibleEmojiCount((previous) => Math.min(customEmojiAssets.length, previous + REACTION_BATCH_SIZE));
                      }}
                    >
                      Load More
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="px-1 text-xs text-cyan-100/70">No custom emojis were found in public/emojis.</p>
              )}
            </div>
          </div>
        ) : (
          <div className={`relative z-30 mt-2 w-full rounded-3xl border border-cyan-300/20 bg-slate-950/95 p-3 shadow-[0_20px_60px_rgba(8,15,30,0.35)] ${mode === "reaction" ? "" : `absolute top-full ${panelPositionClass} w-[min(22rem,calc(100vw-2rem))]`}`}>
            {mode === "reaction" ? (
              <div className="mb-4 flex flex-col gap-3 sm:gap-4">
                {recentlyUsedAssets.length > 0 && (
                  <div className="space-y-2 rounded-3xl border border-cyan-300/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Frequently Used</p>
                      <span className="text-[11px] text-cyan-100/60">{recentlyUsedAssets.length} recent</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {recentlyUsedAssets.map((emoji) => (
                        <button
                          key={`recent-${emoji.id}`}
                          type="button"
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/10 bg-black/30 transition hover:border-cyan-300/40 hover:bg-cyan-900/60"
                          onClick={() => handleSelect(emoji)}
                          title={emoji.name}
                        >
                          <CustomEmojiImage src={emoji.url} alt={emoji.name} className="h-6 w-6 rounded-xl object-contain" title={emoji.name} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Custom emojis</p>
                  <span className="text-[11px] text-cyan-100/60">{customEmojiAssets.length} loaded</span>
                </div>
              </div>
            ) : (
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/80">Custom emojis</p>
                <span className="text-xs text-cyan-100/60">{customEmojiAssets.length} loaded</span>
              </div>
            )}

            {customEmojiAssets.length > 0 ? (
              <div className={`grid max-h-[18rem] grid-cols-6 gap-2 overflow-y-auto rounded-3xl border border-cyan-300/10 bg-black/20 p-2 ${mode === "reaction" ? "sm:grid-cols-7" : "sm:grid-cols-7"}`}>
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
        )
      ) : null}
    </div>
  );
}
