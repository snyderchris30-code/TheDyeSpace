"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [redirect, setRedirect] = useState("/");
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirect(params.get("redirect") || "/");
    const shouldVerify = params.get("verify");
    if (shouldVerify === "true") {
      setMessage("Email verification sent. Check your inbox and then log in.");
    }
  }, []);

  async function handleSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = e.currentTarget;
    const email = form.email.value;
    const password = form.password.value;
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Check your email for a magic link. Verify to continue.");
      if (data?.user) {
        setTimeout(() => router.push(`/login?redirect=${encodeURIComponent(redirect)}&verify=true`), 1200);
      }
    }
    setLoading(false);
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
          <Link href="/login" className="underline text-pink-300 hover:text-yellow-300">Log in</Link>
        </p>
        {message && (
          <div className="text-center text-pink-300 font-semibold mt-2 animate-pulse">{message}</div>
        )}
      </form>
    </div>
  );
}
