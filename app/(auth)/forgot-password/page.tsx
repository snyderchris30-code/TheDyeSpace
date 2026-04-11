"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";

const LIVE_SITE_URL = "https://thedyespace.app";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleForgotPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    const form = e.currentTarget;
    const email = form.email.value;
    const supabase = createClient();

    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${LIVE_SITE_URL}/reset-password`,
      });

      if (err) {
        setError(err.message);
      } else {
        setSubmitted(true);
        setMessage("Check your email for a password reset link.");
      }
    } catch (e: any) {
      setError(e?.message || "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        onSubmit={handleForgotPassword}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Reset Password</h1>
        <p className="text-center text-sm text-slate-300 mb-4">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </p>

        {!submitted ? (
          <>
            <input
              name="email"
              type="email"
              placeholder="Enter your email"
              required
              className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-tr from-purple-700 via-pink-600 to-yellow-400 text-white font-bold py-2 rounded shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
            >
              {loading ? <Loader2 className="animate-spin mr-2" /> : null}
              Send Reset Link
            </button>
          </>
        ) : (
          <div className="text-center text-green-300 font-semibold">
            ✓ Email sent! Check your inbox for a reset link.
          </div>
        )}

        {error && (
          <div className="text-center text-red-300 font-semibold mt-2">{error}</div>
        )}
        {message && !error && (
          <div className="text-center text-pink-300 font-semibold mt-2">{message}</div>
        )}

        <div className="text-center text-sm mt-4">
          Remember your password?{' '}
          <Link href="/login" prefetch={false} className="underline text-pink-300 hover:text-yellow-300">Log in</Link>
        </div>
      </form>
    </div>
  );
}
