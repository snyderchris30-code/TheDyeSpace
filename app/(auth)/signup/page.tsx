"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import CaptchaChallenge from "@/app/CaptchaChallenge";

export default function SignupPage() {
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
      ? new URLSearchParams(window.location.search).get("verify") === "true"
        ? "Email verification sent. Check your inbox and then log in."
        : null
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

  async function handleSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (lockedUntil && Date.now() < lockedUntil) {
      setMessage("Too many failed attempts. Please wait a minute and try again.");
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      if (!captchaState.token) {
        setMessage("The vibe check is still loading. Try again in a second.");
        return;
      }

      console.log("[CAPTCHA] signup verify request", {
        selectedIds: captchaState.selectedIds,
        tokenLength: captchaState.token.length,
      });

      const { response: captchaResponse, body: captchaBody } = await fetchJsonWithTimeout(
        "/api/captcha",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: captchaState.token, selectedIds: captchaState.selectedIds }),
        },
        8000
      );

      console.log("[CAPTCHA] signup verify response", {
        status: captchaResponse?.status,
        body: captchaBody,
      });

      if (!captchaResponse || !captchaResponse.ok || captchaBody?.ok !== true) {
        const reason = captchaBody?.reason || "verification failed";
        const message = captchaBody?.message || (reason === "expired" || reason === "invalid" ? "The CAPTCHA expired. Try again." : "Not quite... try again");
        console.warn("[CAPTCHA] signup verify failed", { reason, selectedIds: captchaState.selectedIds, message });
        if (reason === "rate_limited") {
          setMessage("Too many CAPTCHA attempts. Please wait a moment and try again.");
          return;
        }
        setMessage(message);
        setCaptchaReloadKey((current) => current + 1);
        return;
      }

      console.log("[CAPTCHA] signup verify succeeded");

      const form = e.currentTarget;
      const email = form.email.value;
      const password = form.password.value;
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({ email, password });
      console.log("[SIGNUP] auth response", { data, error });

      if (error) {
        setFailedAttempts((prev) => {
          const next = prev + 1;
          if (next >= 5) {
            setLockedUntil(Date.now() + 60_000);
          }
          return next;
        });
        setMessage(error.message);
        return;
      }

      setFailedAttempts(0);
      setLockedUntil(null);
      if (data?.session && data?.user) {
        setMessage("Welcome to TheDyeSpace!");

        const initResponse = await Promise.race([
          fetch("/api/profile/init", { method: "POST" }).catch(() => null),
          new Promise<Response | null>((resolve) => window.setTimeout(() => resolve(null), 2500)),
        ]);

        const initBody = initResponse ? await initResponse.json().catch(() => ({})) : {};
        const initializedUsername = typeof initBody?.profile?.username === "string" ? initBody.profile.username : null;

        if (initializedUsername) {
          setTimeout(() => router.push(`/profile/${encodeURIComponent(initializedUsername)}?edit=1&welcome=1`), 800);
        } else {
          setTimeout(() => router.push("/profile?edit=1&welcome=1"), 800);
        }
      } else {
        setMessage("Check your email for a magic link. Verify to continue.");
        if (data?.user) {
          const signupRedirect = "/profile?edit=1&welcome=1";
          setTimeout(() => router.push(`/login?redirect=${encodeURIComponent(signupRedirect)}&verify=true`), 1200);
        }
      }
    } catch (error) {
      console.error("[SIGNUP] unexpected error", error);
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        onSubmit={handleSignup}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Join TheDyeSpace</h1>
        <input
          name="email"
          type="email"
          placeholder="Enter your email"
          required
          className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
        />
        <input
          name="password"
          type="password"
          placeholder="Create a password"
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
          Sign Up
        </button>
        <p className="text-center text-sm mt-2">
          Already have an account?{' '}
          <Link href="/login" prefetch={false} className="underline text-pink-300 hover:text-yellow-300">Log in</Link>
        </p>
        {message && (
          <div className="text-center text-pink-300 font-semibold mt-2 animate-pulse">{message}</div>
        )}
      </form>
    </div>
  );
}
