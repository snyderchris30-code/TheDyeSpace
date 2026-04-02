"use client";

import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check if we have a valid reset token in the URL
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsValidToken(true);
      setShowForm(true);
    } else {
      // No valid token, show error
      setIsValidToken(false);
      setError("Invalid or expired reset link. Please request a new one.");
    }
  }, []);

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

    const supabase = createClient();

    try {
      const { error: err } = await supabase.auth.updateUser({ password });

      if (err) {
        setError(err.message);
      } else {
        setMessage("Password reset successfully!");
        setTimeout(() => {
          router.push("/");
        }, 1500);
      }
    } catch (e: any) {
      setError(e?.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (isValidToken === null) {
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
        {isValidToken && showForm ? (
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
            <Link href="/auth/forgot-password" className="underline text-pink-300 hover:text-yellow-300">
              Request a new reset link
            </Link>
          </div>
        )}

        {error && (
          <div className="text-center text-red-300 font-semibold mt-2">{error}</div>
        )}
        {message && (
          <div className="text-center text-green-300 font-semibold mt-2">{message}</div>
        )}
      </form>
    </div>
  );
}
