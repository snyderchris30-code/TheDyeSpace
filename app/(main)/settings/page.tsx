"use client";

import { createClient } from "@/lib/supabase/client";
import AsyncStateCard from "@/app/AsyncStateCard";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import { APP_VERSION } from "@/lib/app-config";
import { hasAdminAccess } from "@/lib/admin-actions";

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
  const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [ghostRidin, setGhostRidin] = useState(false);
  const [verifiedBadge, setVerifiedBadge] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [appUpdating, setAppUpdating] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login?redirect=/settings");
        return;
      }
      supabase
        .from("profiles")
        .select("username, role, ghost_ridin, verified_badge")
        .eq("id", user.id)
        .maybeSingle()
        .then(async ({ data: profile }) => {
          setUsername(sanitizeUsernameInput(profile?.username ?? ""));
          const adminRole = hasAdminAccess(user.id, profile?.role ?? null);
          setIsAdmin(adminRole);
          setGhostRidin(profile?.ghost_ridin === true);
          setVerifiedBadge(profile?.verified_badge === true);
          setLoading(false);
        });
    });
  }, [supabase, router]);

  async function handleSaveProfileSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/profile/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghostRidin }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to save profile settings.");
      }
      setMessage(
        ghostRidin
          ? "Ghost Ridin is active. Your profile is now hidden from regular users."
          : "Ghost Ridin is off. Your profile is visible again."
      );
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Failed to save profile settings.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleDeleteAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDeleteBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation.trim() }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to delete account.");
      }

      router.push("/signup");
    } catch (err: any) {
      setError(typeof err?.message === "string" ? err.message : "Failed to delete account.");
    } finally {
      setDeleteBusy(false);
    }
  }

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

  async function handleUpdateApp() {
    if (appUpdating) {
      return;
    }

    setAppUpdating(true);
    setAppUpdateError(null);
    setMessage(null);
    setError(null);

    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(async (registration) => {
            try {
              await registration.update();
            } catch {
              // Best effort only.
            }
          })
        );
        await Promise.all(
          registrations.map(async (registration) => {
            try {
              await registration.unregister();
            } catch {
              // Best effort only.
            }
          })
        );
      }

      if (typeof window !== "undefined" && "caches" in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
      }

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("updateApp", String(Date.now()));

      const warmResponse = await fetch(nextUrl.toString(), {
        method: "GET",
        cache: "reload",
        credentials: "same-origin",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });

      if (!warmResponse.ok) {
        throw new Error("Couldn't grab the latest version right now. Try again in a sec.");
      }

      window.location.replace(nextUrl.toString());
    } catch (updateError: any) {
      setAppUpdating(false);
      setAppUpdateError(
        typeof updateError?.message === "string"
          ? updateError.message
          : "Couldn't refresh the app right now. Please try again."
      );
    }
  }

  async function handleCopyFanChatInvite() {
    if (!username) {
      setError("Your username is not ready yet.");
      return;
    }

    try {
      const inviteUrl = `${window.location.origin}/chat?seller=${encodeURIComponent(username)}`;
      await navigator.clipboard.writeText(inviteUrl);
      setMessage("Fan chat invite link copied.");
    } catch {
      setError("Could not copy invite link right now.");
    }
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

  if (appUpdating) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-2xl">
          <AsyncStateCard
            loading
            title="Updating TheDyeSpace... hold tight"
            message="Rolling a fresh one, be right back. We are pulling the latest version from the server now."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-cyan-100">Profile Settings</h1>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/45 bg-cyan-400/15 px-3 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">App Version</span>
            <span className="rounded-full bg-cyan-200/90 px-2 py-0.5 text-xs font-bold text-slate-900">{APP_VERSION}</span>
          </div>
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

      <section className="rounded-2xl border border-emerald-300/20 bg-black/40 p-6 backdrop-blur-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 p-2 text-emerald-200">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-emerald-100">Update App</h2>
            <p className="mt-2 text-sm text-emerald-100/85">
              Pull the latest version straight from the server and refresh this app if your phone feels stuck on an older build.
            </p>
          </div>
        </div>

        {appUpdateError ? (
          <p className="mb-4 rounded-lg bg-rose-900/30 px-3 py-2 text-sm text-rose-300">
            {appUpdateError}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleUpdateApp()}
          disabled={appUpdating}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-300 via-lime-300 to-yellow-200 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
        >
          <RefreshCw className="h-4 w-4" />
          {appUpdating ? "Updating TheDyeSpace..." : "Check for Updates"}
        </button>

        <p className="mt-3 text-xs text-emerald-100/65">
          This clears the app cache and reloads a fresh copy for a cleaner mobile refresh.
        </p>
      </section>

      <section className="rounded-2xl border border-cyan-300/20 bg-black/40 p-6 backdrop-blur-sm">
        <h2 className="text-xl font-semibold text-cyan-100">Profile Visibility</h2>
        <p className="mt-2 text-sm text-cyan-200/85">
          Enable <span className="font-semibold text-cyan-100">Ghost Ridin</span> to hide your profile from regular users while keeping your account active.
        </p>
        {verifiedBadge && username ? (
          <div className="mt-4 rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/5 px-4 py-4">
            <p className="text-sm font-semibold text-fuchsia-100">Verified Seller Chat Group</p>
            <p className="mt-1 text-sm text-fuchsia-100/75">
              Share your private fan chat invite link with fans. When Ghost Ridin is enabled, this chat stays hidden from regular users.
            </p>
            <button
              type="button"
              onClick={() => void handleCopyFanChatInvite()}
              className="mt-3 rounded-full border border-fuchsia-300/45 bg-fuchsia-400/10 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/20"
            >
              Invite to My Chat Group
            </button>
          </div>
        ) : null}

        <form onSubmit={handleSaveProfileSettings} className="mt-5 flex flex-col gap-4">
          <label className="flex items-center gap-3 rounded-xl border border-white/15 bg-black/30 px-4 py-3">
            <input
              type="checkbox"
              checked={ghostRidin}
              onChange={(e) => setGhostRidin(e.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-black/40 text-cyan-300 focus:ring-cyan-300"
            />
            <span className="text-sm text-cyan-100">Ghost Ridin (hidden profile mode)</span>
          </label>

          <button
            type="submit"
            disabled={profileSaving}
            className="rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
          >
            {profileSaving ? "Saving..." : "Save Profile Settings"}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-cyan-300/20 bg-black/40 p-6 backdrop-blur-sm">
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

      <section className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-950/20 p-6 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-rose-300" />
          <h2 className="text-xl font-semibold text-rose-100">Delete Account</h2>
        </div>
        <p className="text-sm text-rose-100/85">
          This permanently deletes your account and cannot be undone.
        </p>

        <form onSubmit={handleDeleteAccount} className="mt-4 flex flex-col gap-3">
          <label className="block">
            <span className="mb-2 block text-sm text-rose-100">
              Type <span className="font-semibold">{DELETE_CONFIRMATION}</span> to confirm
            </span>
            <input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={DELETE_CONFIRMATION}
              className="w-full rounded-xl border border-rose-300/30 bg-black/40 px-4 py-3 text-white outline-none focus:border-rose-300/60"
            />
          </label>

          <button
            type="submit"
            disabled={deleteBusy || deleteConfirmation.trim() !== DELETE_CONFIRMATION}
            className="rounded-full bg-gradient-to-r from-rose-400 via-red-400 to-orange-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
          >
            {deleteBusy ? "Deleting..." : "Delete My Account"}
          </button>
        </form>
      </section>

      {isAdmin ? (
        <section className="mt-6 rounded-2xl border border-fuchsia-300/20 bg-black/40 p-6 backdrop-blur-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-fuchsia-100">Emoji Manager</h2>
              <p className="mt-1 text-sm text-fuchsia-200/80">
                Manage auto-imported emojis and category assignments from one unified admin page.
              </p>
            </div>
            <Link href="/emojis" className="rounded-full border border-fuchsia-300/20 bg-fuchsia-900/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-900/30">
              Open Emoji Manager
            </Link>
          </div>
          <p className="text-xs text-fuchsia-200/60">Drop new .png or .gif files into public/emojis and reload.</p>
        </section>
      ) : null}
    </div>
  );
}
