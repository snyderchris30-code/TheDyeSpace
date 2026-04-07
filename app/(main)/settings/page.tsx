"use client";

import { createClient } from "@/lib/supabase/client";
import AsyncStateCard from "@/app/AsyncStateCard";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import { APP_VERSION } from "@/lib/app-config";
import { normalizeCustomEmojiUrls } from "@/lib/custom-emojis";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[70vh] items-center justify-center px-4">
          <div className="w-full max-w-2xl">
            <AsyncStateCard
              loading
              title="Loading settings"
              message="Preparing your account settings and recovery tools."
            />
          </div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isRecovery = searchParams.get("recovery") === "1";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [customEmojiUrls, setCustomEmojiUrls] = useState<string[]>([]);
  const [emojiUrlInput, setEmojiUrlInput] = useState("");
  const [emojiImportInput, setEmojiImportInput] = useState("");
  const [emojiSaving, setEmojiSaving] = useState(false);
  const [emojiMessage, setEmojiMessage] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login?redirect=/settings");
        return;
      }
      supabase
        .from("profiles")
        .select("username, role")
        .eq("id", user.id)
        .maybeSingle()
        .then(async ({ data: profile }) => {
          setUsername(sanitizeUsernameInput(profile?.username ?? ""));
          const adminRole = profile?.role === "admin";
          setIsAdmin(adminRole);

          if (adminRole) {
            const response = await fetch("/api/admin/custom-emojis", { cache: "no-store" });
            const body = await response.json().catch(() => ({}));
            if (response.ok) {
              setCustomEmojiUrls(normalizeCustomEmojiUrls(body?.emojiUrls || [], 300));
            }
          }

          setLoading(false);
        });
    });
  }, [supabase, router]);

  const addSingleEmojiUrl = () => {
    setEmojiMessage(null);
    const next = normalizeCustomEmojiUrls([emojiUrlInput], 1);
    if (!next.length) {
      setEmojiMessage("Please paste a valid public emoji image URL.");
      return;
    }

    setCustomEmojiUrls((prev) => normalizeCustomEmojiUrls([...prev, ...next], 300));
    setEmojiUrlInput("");
    setEmojiMessage("Emoji URL added to the preview list.");
  };

  const importEmojiList = () => {
    setEmojiMessage(null);
    const imported = normalizeCustomEmojiUrls(emojiImportInput, 300);
    if (!imported.length) {
      setEmojiMessage("No valid URLs found in the import list.");
      return;
    }

    setCustomEmojiUrls((prev) => normalizeCustomEmojiUrls([...prev, ...imported], 300));
    setEmojiMessage(`Imported ${imported.length} emoji URL${imported.length === 1 ? "" : "s"}.`);
    setEmojiImportInput("");
  };

  const removeEmojiUrl = (targetUrl: string) => {
    setCustomEmojiUrls((prev) => prev.filter((url) => url !== targetUrl));
  };

  const saveCustomEmojis = async () => {
    setEmojiSaving(true);
    setEmojiMessage(null);

    const response = await fetch("/api/admin/custom-emojis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiUrls: customEmojiUrls }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setEmojiSaving(false);
      setEmojiMessage(body?.error || "Failed to save custom emojis.");
      return;
    }

    setCustomEmojiUrls(normalizeCustomEmojiUrls(body?.emojiUrls || customEmojiUrls, 300));
    setEmojiSaving(false);
    setEmojiMessage("Custom emoji list saved.");
  };

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const form = e.currentTarget;
    const newPassword = (form.elements.namedItem("newPassword") as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value;

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      setSaving(false);
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      setSaving(false);
      return;
    }

    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    if (err) {
      setError(
        "Failed to update password. Your session may have expired — please request a new reset link."
      );
    } else {
      setMessage("Password updated successfully!");
      form.reset();
      if (isRecovery) {
        setTimeout(() => {
          if (username && username.length >= 3) {
            router.push(`/profile/${encodeURIComponent(username)}`);
          } else {
            router.push("/");
          }
        }, 1500);
      }
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-2xl">
          <AsyncStateCard
            loading
            title="Loading settings"
            message="Fetching your account details and admin tools now."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-cyan-100">Account Settings</h1>
          <p className="mt-1 text-sm text-cyan-300">Version {APP_VERSION}</p>
        </div>
        {username && username.length >= 3 && (
          <Link
            href={`/profile/${encodeURIComponent(username)}`}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            ← Back to Profile
          </Link>
        )}
      </div>

      <section className="rounded-2xl border border-cyan-300/20 bg-black/40 p-6 backdrop-blur-sm">
        <div className="mb-5 flex items-center gap-2">
          <Lock className="h-5 w-5 text-cyan-300" />
          <h2 className="text-xl font-semibold text-cyan-100">Change Password</h2>
        </div>

        {isRecovery && (
          <div className="mb-4 rounded-xl border border-cyan-400/30 bg-cyan-900/20 px-4 py-3 text-sm text-cyan-200">
            Enter your new password below to complete your account recovery.
          </div>
        )}

        <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-2 block text-sm text-cyan-100">New Password</span>
            <input
              name="newPassword"
              type="password"
              required
              minLength={6}
              autoFocus={isRecovery}
              placeholder="New password"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-cyan-100">Confirm New Password</span>
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={6}
              placeholder="Confirm new password"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
            />
          </label>

          {error && (
            <p className="rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">{error}</p>
          )}
          {message && (
            <p className="rounded-lg bg-emerald-900/30 px-3 py-2 text-sm text-emerald-300">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
          >
            {saving ? "Updating..." : "Update Password"}
          </button>
        </form>
      </section>

      {isAdmin ? (
        <section className="mt-6 rounded-2xl border border-fuchsia-300/20 bg-black/40 p-6 backdrop-blur-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-fuchsia-100">Emoji Manager</h2>
            <p className="mt-1 text-sm text-fuchsia-200/80">
              Add CC0/public emoji image URLs, import lists, preview, and save for global post/comment pickers.
            </p>
          </div>

          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={emojiUrlInput}
              onChange={(event) => setEmojiUrlInput(event.target.value)}
              placeholder="https://example.com/emoji.png"
              className="flex-1 rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-fuchsia-300/50"
            />
            <button
              type="button"
              onClick={addSingleEmojiUrl}
              className="rounded-full border border-fuchsia-300/40 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30"
            >
              Add URL
            </button>
          </div>

          <label className="mb-4 block">
            <span className="mb-2 block text-sm text-fuchsia-100">Import Emoji URLs (one per line or comma separated)</span>
            <textarea
              value={emojiImportInput}
              onChange={(event) => setEmojiImportInput(event.target.value)}
              className="min-h-24 w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-fuchsia-300/50"
              placeholder="https://example.com/emoji1.png&#10;https://example.com/emoji2.png"
            />
          </label>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={importEmojiList}
              className="rounded-full border border-fuchsia-300/40 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30"
            >
              Import List
            </button>
            <button
              type="button"
              onClick={saveCustomEmojis}
              disabled={emojiSaving}
              className="rounded-full bg-gradient-to-r from-fuchsia-300 via-pink-300 to-rose-300 px-6 py-2 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
            >
              {emojiSaving ? "Saving..." : "Save Custom Emojis"}
            </button>
            <p className="text-xs text-fuchsia-200/80">{customEmojiUrls.length} configured</p>
          </div>

          {emojiMessage ? (
            <p className="mb-3 rounded-lg border border-fuchsia-300/30 bg-fuchsia-500/10 px-3 py-2 text-sm text-fuchsia-100">{emojiMessage}</p>
          ) : null}

          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10">
            {customEmojiUrls.map((url) => (
              <button
                key={url}
                type="button"
                title="Remove emoji"
                onClick={() => removeEmojiUrl(url)}
                className="group relative rounded-xl border border-fuchsia-300/20 bg-black/25 p-1 hover:border-fuchsia-300/60"
              >
                <img src={url} alt="custom emoji" className="h-10 w-10 rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />
                <span className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white group-hover:flex">×</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
