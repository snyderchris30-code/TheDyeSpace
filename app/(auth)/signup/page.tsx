"use client";

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
  const isCaptchaReady = Boolean(captchaState.token && captchaState.selectedIds.length > 0);

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
    const submittedForm = e.currentTarget;

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

    if (!captchaState.selectedIds.length) {
      setMessage("Select the matching CAPTCHA images before signing up.");
      setLoading(false);
      return;
    }

    try {
      console.log("Stoned CAPTCHA submit - selected images:", captchaState.selectedIds);

      const verifyResult = await fetchJsonWithTimeout(
        "/api/captcha",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: captchaState.token, selectedImages: captchaState.selectedIds }),
        },
        8000
      );

      console.log("[CAPTCHA] signup verify response", {
        status: verifyResult.response?.status,
        body: verifyResult.body,
      });
      const captchaSuccess = verifyResult.response?.ok === true && verifyResult.body?.success === true;
      console.log(`Verification result: ${captchaSuccess ? "success" : "failure"}`);

      if (!captchaSuccess) {
        setMessage("Not quite... try again");
        setCaptchaReloadKey((current) => current + 1);
        return;
      }
    } catch (error) {
      console.error("[CAPTCHA] signup verify exception", error);
      setMessage("Not quite... try again");
      setCaptchaReloadKey((current) => current + 1);
      return;
    }

    try {
      console.log("CAPTCHA success - proceeding with signup");
      console.log("Signup attempt started");

      const formElement = submittedForm instanceof HTMLFormElement
        ? submittedForm
        : document.getElementById("signup-form");

      if (!(formElement instanceof HTMLFormElement)) {
        throw new Error("Signup form element was not found.");
      }

      const formData = new FormData(formElement);
      const email = String(formData.get("email") || "").trim();
      const password = String(formData.get("password") || "");
      console.log("Signup attempt with email:", email);
      if (!email || !password) {
        setMessage("Please enter both email and password.");
        return;
      }
      const supabase = createClient();

      // --- FIX: Clean session before signup, then signup ---
      try {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
        if (signOutError) {
          console.warn("[SIGNUP] global signOut before signup failed", signOutError.message);
        }
      } catch (e) {
        console.warn("[SIGNUP] signOut before signup failed", e);
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      console.log("Supabase signup response:", { data, error });

      if (error) {
        console.error("[SIGNUP] signUp failed with exact error message:", error.message);
        setFailedAttempts((prev) => {
          const next = prev + 1;
          if (next >= 5) {
            setLockedUntil(Date.now() + 60_000);
          }
          return next;
        });
        setMessage(`Unable to complete signup: ${error.message}`);
        return;
      }

      setFailedAttempts(0);
      setLockedUntil(null);
      if (data?.session && data?.user) {
        setMessage("Signup successful! Redirecting...");
        setTimeout(() => router.push(redirect || "/"), 800);
      } else {
        setMessage("Signup successful! Please verify your email, then log in.");
        setTimeout(() => router.push(`/login?redirect=${encodeURIComponent(redirect || "/")}&verify=true`), 1200);
      }
    } catch (error) {
      console.error("[SIGNUP] unexpected error", error);
      setMessage("Unable to complete signup due to an unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        id="signup-form"
        onSubmit={handleSignup}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Join TheDyeSpace</h1>
        <label htmlFor="signup-email" className="sr-only">Email</label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          required
          className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
        />
        <label htmlFor="signup-password" className="sr-only">Password</label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a password"
          required
          minLength={6}
          className="px-4 py-2 rounded bg-purple-950/60 border border-purple-700 text-white focus:outline-none focus:ring-2 focus:ring-pink-400"
        />
        <CaptchaChallenge onStateChange={setCaptchaState} reloadKey={captchaReloadKey} />
        <button
          type="submit"
          disabled={loading || !isCaptchaReady}
          className="bg-gradient-to-tr from-purple-700 via-pink-600 to-yellow-400 text-white font-bold py-2 rounded shadow-lg hover:scale-105 transition-transform flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
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
