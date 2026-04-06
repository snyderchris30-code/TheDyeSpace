"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizeMusicPlayerUrls } from "@/lib/youtube-media";
import { DEFAULT_PUBLIC_MUSIC_TITLE } from "@/lib/app-config";

export default function MusicPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [songInput, setSongInput] = useState("");
  const [musicUrls, setMusicUrls] = useState<string[]>([]);

  const loadMusicUrls = useCallback(async (targetUserId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("theme_settings")
      .eq("id", targetUserId)
      .maybeSingle();

    if (error) {
      setStatus(error.message || "Could not load your playlist.");
      setMusicUrls([]);
      return;
    }

    const nextUrls = normalizeMusicPlayerUrls(
      Array.isArray((data?.theme_settings as { music_player_urls?: string[] | null } | null)?.music_player_urls)
        ? ((data?.theme_settings as { music_player_urls?: string[] | null }).music_player_urls as string[])
        : []
    );

    setMusicUrls(nextUrls);
  }, [supabase]);

  useEffect(() => {
    let active = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user?.id || null;
      if (!active) return;

      setUserId(id);
      if (id) {
        await loadMusicUrls(id);
      }
      if (!active) return;
      setLoading(false);
    };

    void init();

    return () => {
      active = false;
    };
  }, [loadMusicUrls, supabase]);

  const persist = useCallback(async (nextUrls: string[], successText = "Playlist saved.") => {
    setSaving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ music_player_urls: nextUrls }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Could not save your playlist.");
      }

      setMusicUrls(normalizeMusicPlayerUrls(nextUrls));
      setStatus(successText);
    } catch (error: any) {
      setStatus(typeof error?.message === "string" ? error.message : "Could not save your playlist.");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleAdd = async () => {
    const rawItems = songInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!rawItems.length) {
      setStatus("Paste at least one YouTube video or playlist URL.");
      return;
    }

    const nextUrls = normalizeMusicPlayerUrls([...musicUrls, ...rawItems]);
    if (!nextUrls.length) {
      setStatus("Only valid YouTube video or playlist URLs can be added.");
      return;
    }

    await persist(nextUrls, "Songs added.");
    setSongInput("");
  };

  const handleRemove = async (url: string) => {
    const nextUrls = musicUrls.filter((value) => value !== url);
    await persist(nextUrls, "Playlist updated.");
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-cyan-50">Music Player Editor</h1>
        <Link
          href="/"
          className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20"
        >
          Back Home
        </Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-6 text-cyan-100">Loading...</div>
      ) : !userId ? (
        <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-6 text-cyan-100">
          Sign in to add your own songs.
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-4 text-sm text-cyan-100/85">
            <p>Default public song for guests: {DEFAULT_PUBLIC_MUSIC_TITLE}</p>
            <p className="mt-1">Once your playlist has songs, only your songs/playlists will be used in the player.</p>
          </div>

          <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-4">
            <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-cyan-300/75">YouTube Links</label>
            <textarea
              className="min-h-28 w-full rounded-2xl border border-cyan-300/25 bg-black/35 px-4 py-3 text-cyan-50 outline-none transition focus:border-cyan-300/55"
              placeholder="Paste YouTube video or playlist URLs, one per line"
              value={songInput}
              onChange={(event) => setSongInput(event.target.value)}
            />
            <button
              type="button"
              className="mt-3 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-60"
              onClick={() => void handleAdd()}
              disabled={saving}
            >
              {saving ? "Saving..." : "Add Songs"}
            </button>
          </div>

          {status ? (
            <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-900/25 px-4 py-2 text-sm text-cyan-100">{status}</div>
          ) : null}

          <div className="mt-5 space-y-2 rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-4">
            <p className="text-sm font-semibold text-cyan-50">Your Saved Songs / Playlists</p>
            {musicUrls.length === 0 ? (
              <p className="text-sm text-cyan-100/70">No songs saved yet.</p>
            ) : (
              musicUrls.map((url) => (
                <div key={url} className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-black/25 px-3 py-2">
                  <p className="truncate text-sm text-cyan-100">{url}</p>
                  <button
                    type="button"
                    className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                    onClick={() => void handleRemove(url)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
