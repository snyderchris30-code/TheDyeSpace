"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CaptchaChallenge from "@/app/CaptchaChallenge";

async function handleSignOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.reload();
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [captchaState, setCaptchaState] = useState<{ token: string | null; selectedIds: string[] }>({ token: null, selectedIds: [] });
  const [captchaReloadKey, setCaptchaReloadKey] = useState(0);
  const [redirect] = useState(() => {
    if (typeof window === "undefined") return "/";
    const params = new URLSearchParams(window.location.search);
    return params.get("redirect") || "/";
  });
  const [message, setMessage] = useState<string | null>(
    typeof window !== "undefined"
      ? (() => {
          const params = new URLSearchParams(window.location.search);
          if (params.get("reset") === "success") {
            return "Password updated. Log in with your new password.";
          }

          return params.get("verify") === "true"
            ? "Please verify your email before logging in. Check your inbox."
            : null;
        })()
      : null
  );
  const router = useRouter();

  async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    } catch (error) {
      console.error("[FETCH] timeout or error", url, error);
      return { response: null, body: {} };
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (lockedUntil && Date.now() < lockedUntil) {
      setMessage("Too many failed attempts. Please wait a minute and try again.");
      return;
    }

    setLoading(true);
    setMessage(null);

    if (!captchaState.token) {
      setMessage("The vibe check is still loading. Try again in a second.");
      setLoading(false);
      return;
    }

    let captchaBody: any = null;
    try {
      console.log("CAPTCHA submit - selected indices:", captchaState.selectedIds);

      const verifyResult = await fetchJsonWithTimeout(
        "/api/captcha",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: captchaState.token, selectedIds: captchaState.selectedIds }),
        },
        8000
      );

      captchaBody = verifyResult.body;
      console.log("[CAPTCHA] login verify response", {
        status: verifyResult.response?.status,
        body: verifyResult.body,
      });

      if (!verifyResult.response) {
        setMessage("Not quite... try again");
        setCaptchaReloadKey((current) => current + 1);
        setLoading(false);
        return;
      }

      const captchaSuccess = verifyResult.body?.success === true || verifyResult.body?.ok === true;
      if (!verifyResult.response.ok || !captchaSuccess) {
        setMessage("Not quite... try again");
        setCaptchaReloadKey((current) => current + 1);
        setLoading(false);
        return;
      }
    } catch (error) {
      console.error("[CAPTCHA] login verify exception", error);
      setMessage("Not quite... try again");
      setCaptchaReloadKey((current) => current + 1);
      setLoading(false);
      return;
    }

    try {
      console.log("[CAPTCHA] login verify succeeded", { response: captchaBody });

      const form = e.currentTarget;
      const email = form.email.value;
      const password = form.password.value;
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      console.log("[LOGIN] auth response", { error });

      if (error) {
        setFailedAttempts((prev) => {
          const next = prev + 1;
          if (next >= 6) {
            setLockedUntil(Date.now() + 60_000);
          }
          return next;
        });
        setMessage(error.message);
        return;
      }

      setFailedAttempts(0);
      setLockedUntil(null);
      void fetch("/api/profile/init", { method: "POST" }).catch(() => null);
      setMessage("Welcome back, cosmic soul!");
      router.push(redirect);
      router.refresh();
    } catch (error) {
      console.error("[LOGIN] unexpected error", error);
      setMessage("Unable to complete login. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        onSubmit={handleLogin}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Welcome to TheDyeSpace</h1>
        <label htmlFor="login-email" className="sr-only">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          required
          className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
        />
        <label htmlFor="login-password" className="sr-only">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          minLength={6}
          className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
        />
        <CaptchaChallenge onStateChange={setCaptchaState} reloadKey={captchaReloadKey} />
        <button
          type="submit"
          disabled={loading}
          className="bg-gradient-to-tr from-purple-700 via-pink-600 to-yellow-400 text-white font-bold py-2 rounded shadow-lg hover:scale-105 transition-transform flex items-center justify-center"
        >
          {loading ? <Loader2 className="animate-spin mr-2" /> : null}
          Log In
        </button>
        <p className="text-center text-sm mt-2">
          New here?{' '}
          <Link href="/signup" className="underline text-pink-300 hover:text-yellow-300">Sign up</Link>
        </p>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="underline text-cyan-300 hover:text-yellow-300">Forgot password?</Link>
        </p>
        {message && (
          <div className="text-center text-pink-300 font-semibold mt-2 animate-pulse">{message}</div>
        )}
        {/* Sign Out (Clear Session) button removed */}
      </form>
    </div>
  );
}
