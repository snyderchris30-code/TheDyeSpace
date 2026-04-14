"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";

type CaptchaOption = {
  id: string;
  src: string;
};

type CaptchaChallengeResponse = {
  prompt: string;
  options: CaptchaOption[];
  token: string;
};

type CaptchaChallengeProps = {
  onStateChange: (state: { token: string | null; selectedIds: string[] }) => void;
  reloadKey?: number;
};

const captchaLoadPromises = new Map<string, Promise<CaptchaChallengeResponse>>();

export default function CaptchaChallenge({ onStateChange, reloadKey = 0 }: CaptchaChallengeProps) {
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<CaptchaOption[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPrompt("Loading the Stoned CAPTCHA...");
    setOptions([]);
    setToken(null);
    setSelectedIds([]);

    const cacheKey = String(reloadKey);
    let challengePromise = captchaLoadPromises.get(cacheKey);

    if (!challengePromise) {
      challengePromise = (async (): Promise<CaptchaChallengeResponse> => {
        const response = await fetch(`/api/captcha?cacheBust=${Date.now()}`, { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as Partial<CaptchaChallengeResponse> & { error?: string };

        if (!response.ok || !body.prompt || !Array.isArray(body.options) || typeof body.token !== "string") {
          throw new Error(body.error || "Could not load the Stoned CAPTCHA.");
        }

        return body as CaptchaChallengeResponse;
      })();

      captchaLoadPromises.set(cacheKey, challengePromise);
      challengePromise.finally(() => {
        if (captchaLoadPromises.get(cacheKey) === challengePromise) {
          captchaLoadPromises.delete(cacheKey);
        }
      });
    }

    try {
      const body = await challengePromise;
      setPrompt(body.prompt);
      setOptions(body.options);
      setToken(body.token);
      setSelectedIds([]);
    } catch (challengeError: any) {
      setError(typeof challengeError?.message === "string" ? challengeError.message : "Could not load the Stoned CAPTCHA.");
    } finally {
      setLoading(false);
    }
  }, [reloadKey]);

  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge]);

  const handleReload = useCallback(() => {
    onStateChange({ token: null, selectedIds: [] });
    void loadChallenge();
  }, [loadChallenge, onStateChange]);

  const toggleSelection = useCallback(
    (imageId: string) => {
      const nextSelectedIds = selectedIds.includes(imageId)
        ? selectedIds.filter((value) => value !== imageId)
        : [...selectedIds, imageId];

      setSelectedIds(nextSelectedIds);

      if (token) {
        onStateChange({ token, selectedIds: nextSelectedIds });
      }
    },
    [onStateChange, selectedIds, token]
  );

  const selectionCountLabel = useMemo(() => `${selectedIds.length} selected`, [selectedIds.length]);

  return (
    <div className="rounded-2xl border border-cyan-300/25 bg-slate-950/55 p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/75">Stoned CAPTCHA</p>
          <h2 className="mt-1 text-sm font-semibold text-cyan-50 sm:text-base">Quick Vibe Check</h2>
          <p className="mt-1 text-xs text-cyan-100/80">{loading ? "Loading challenge..." : prompt}</p>
        </div>
        <button
          type="button"
          onClick={handleReload}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-400/10"
          aria-label="Load a new Stoned CAPTCHA challenge"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          New set
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-200" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300/30 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {options.map((option, index) => {
              const active = selectedIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleSelection(option.id)}
                  className={[
                    "group relative overflow-hidden rounded-2xl border bg-black/30 p-1 transition",
                    active
                      ? "border-lime-300 shadow-[0_0_0_1px_rgba(190,242,100,0.5)]"
                      : "border-white/10 hover:border-cyan-300/50",
                  ].join(" ")}
                  data-selected={active ? "true" : "false"}
                  aria-label={`CAPTCHA option ${index + 1}`}
                >
                  <div className="relative aspect-square overflow-hidden rounded-[18px] bg-slate-900/80">
                    <img
                      src={option.src}
                      alt={`CAPTCHA option ${index + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div
                    className={[
                      "absolute inset-x-2 bottom-2 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition",
                      active ? "bg-lime-300 text-slate-950" : "bg-black/65 text-cyan-100",
                    ].join(" ")}
                  >
                    {active ? "Selected" : "Tap to choose"}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-cyan-100/75">
            <span>{selectionCountLabel}</span>
            <span>Pick every match before submitting.</span>
          </div>
        </>
      )}
    </div>
  );
}
