"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function initializeRecoverySession() {
      setInitializing(true);
      setError(null);

      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);

      const urlError = searchParams.get("error_description") || hashParams.get("error_description");
      if (urlError) {
        if (!isMounted) return;
        setCanReset(false);
        setError(decodeURIComponent(urlError));
        setInitializing(false);
        return;
      }

      const type = searchParams.get("type") || hashParams.get("type");
      const code = searchParams.get("code");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (type === "recovery" && code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!isMounted) return;

        if (exchangeError) {
          setCanReset(false);
          setError(exchangeError.message || "Invalid or expired reset link. Please request a new one.");
          setInitializing(false);
          return;
        }

        setCanReset(true);
        setInitializing(false);
        return;
      }

      if (type === "recovery" && accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!isMounted) return;

        if (sessionError) {
          setCanReset(false);
          setError(sessionError.message || "Invalid or expired reset link. Please request a new one.");
          setInitializing(false);
          return;
        }

        window.history.replaceState({}, document.title, "/reset-password");
        setCanReset(true);
        setInitializing(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (sessionData.session) {
        setCanReset(true);
      } else {
        setCanReset(false);
        setError("Invalid or expired reset link. Please request a new one.");
      }

      setInitializing(false);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return;

      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setCanReset(true);
        setError(null);
        setInitializing(false);
      }
    });

    initializeRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [searchParams, supabase]);

  async function handleResetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    const form = e.currentTarget;
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      setLoading(false);
      return;
    }

    try {
      const { error: err } = await supabase.auth.updateUser({ password });

      if (err) {
        setError(err.message);
      } else {
        await supabase.auth.signOut();
        setMessage("Password reset successfully. Redirecting to login...");
        window.setTimeout(() => {
          router.push("/login?reset=success");
          router.refresh();
        }, 1200);
      }
    } catch (e: any) {
      setError(e?.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (initializing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh]">
        <div className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md">
          <h1 className="glow-text text-3xl mb-2 text-center">Reset Password</h1>
          <div className="flex items-center justify-center">
            <Loader2 className="animate-spin text-pink-300" size={28} />
          </div>
          <p className="text-center text-slate-300">Checking reset link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        onSubmit={handleResetPassword}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Set New Password</h1>
        {canReset ? (
          <>
            <p className="text-center text-sm text-slate-300 mb-4">
              Enter your new password below.
            </p>
            <input
              name="password"
              type="password"
              placeholder="New password"
              required
              minLength={6}
              className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            <input
              name="confirmPassword"
              type="password"
              placeholder="Confirm password"
              required
              minLength={6}
              className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-tr from-purple-700 via-pink-600 to-yellow-400 text-white font-bold py-2 rounded shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
            >
              {loading ? <Loader2 className="animate-spin mr-2" /> : null}
              Reset Password
            </button>
          </>
        ) : (
          <div className="text-center">
            <div className="text-red-300 font-semibold mb-4">{error}</div>
            <Link href="/forgot-password" className="underline text-pink-300 hover:text-yellow-300">
              Request a new reset link
            </Link>
          </div>
        )}

        {error && canReset && (
          <div className="text-center text-red-300 font-semibold mt-2">{error}</div>
        )}
        {message && (
          <div className="text-center text-green-300 font-semibold mt-2">{message}</div>
        )}
      </form>
    </div>
  );
}
