"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import { APP_VERSION } from "@/lib/app-config";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[70vh] items-center justify-center">
          <Loader2 className="animate-spin text-pink-300" size={28} />
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login?redirect=/settings");
        return;
      }
      supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data: profile }) => {
          setUsername(sanitizeUsernameInput(profile?.username ?? ""));
          setLoading(false);
        });
    });
  }, [supabase, router]);

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
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="animate-spin text-pink-300" size={28} />
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
    </div>
  );
}
