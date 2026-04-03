"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

async function handleSignOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.reload();
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [redirect, setRedirect] = useState("/");
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirect(params.get("redirect") || "/");
    const verify = params.get("verify");
    if (verify === "true") {
      setMessage("Please verify your email before logging in. Check your inbox.");
    }
  }, []);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = e.currentTarget;
    const email = form.email.value;
    const password = form.password.value;
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
    else {
      setMessage("Welcome back, cosmic soul!");
      setTimeout(() => router.push(redirect), 1200);
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <form
        onSubmit={handleLogin}
        className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md"
      >
        <h1 className="glow-text text-3xl mb-2 text-center">Welcome to TheDyeSpace</h1>
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
          placeholder="Enter your password"
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
