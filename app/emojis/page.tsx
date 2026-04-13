"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import EmojiCategoryEditor from "@/app/EmojiCategoryEditor";
import { createClient } from "@/lib/supabase/client";
import { hasAdminAccess } from "@/lib/admin-actions";
import type { CustomEmojiAsset } from "@/lib/custom-emojis";

export default function EmojiManagerPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [emojiAssets, setEmojiAssets] = useState<CustomEmojiAsset[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!active) return;

        if (!user) {
          setErrorMessage("Sign in as an admin to manage emojis.");
          setLoading(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .maybeSingle();

        if (!active) return;

        const adminRole = hasAdminAccess(user.id, profile?.role ?? null);
        setIsAdmin(adminRole);

        if (!adminRole) {
          setErrorMessage("Admin access is required to open the Emoji Manager.");
          setLoading(false);
          return;
        }

        const response = await fetch("/api/emojis", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        const emojis = Array.isArray(body?.emojis) ? (body.emojis as CustomEmojiAsset[]) : [];
        if (active) {
          setEmojiAssets(emojis);
        }
      } catch (error: any) {
        if (active) {
          setErrorMessage("Unable to load emoji assets at this time.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [supabase]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-cyan-100">Emoji Manager</h1>
          <p className="mt-2 max-w-2xl text-sm text-cyan-200/80 sm:text-base">
            Manage all auto-imported emojis and assign them into categories from one clean page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/settings" className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-black/40 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-900/40">
            <ArrowLeft size={16} /> Back to Settings
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-cyan-300/20 bg-black/40 p-6 shadow-2xl shadow-cyan-500/5">
        {loading ? (
          <div className="rounded-3xl border border-cyan-300/20 bg-slate-950/80 p-8 text-center text-cyan-100">
            Loading emoji manager...
          </div>
        ) : errorMessage ? (
          <div className="rounded-3xl border border-rose-400/20 bg-rose-950/20 p-8 text-center text-rose-200">
            <p className="text-sm">{errorMessage}</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-cyan-200/80">Automatic emoji import</p>
                <p className="mt-1 text-sm text-cyan-200/80">
                  {emojiAssets.length} emojis loaded from <span className="font-semibold text-cyan-100">public/emojis</span>.
                </p>
              </div>
            </div>
            <EmojiCategoryEditor emojis={emojiAssets} isAdmin={isAdmin} />
          </>
        )}
      </div>
    </div>
  );
}
