"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const INVALID_RESET_LINK_MESSAGE = "This reset link is invalid or has expired. Please request a new one.";
const LIVE_SITE_ORIGIN = "https://thedyespace.app";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initializeRecoverySession() {
      setInitializing(true);
      setError(null);

      const currentOrigin = window.location.origin;
      if (currentOrigin !== LIVE_SITE_ORIGIN) {
        window.location.replace(`${LIVE_SITE_ORIGIN}/reset-password${window.location.search}${window.location.hash}`);
        return;
      }

      const urlParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);

      const urlError = urlParams.get("error_description") || hashParams.get("error_description");
      if (urlError) {
        if (!isMounted) return;
        setError(INVALID_RESET_LINK_MESSAGE);
        setInitializing(false);
        return;
      }

      const type = urlParams.get("type") || hashParams.get("type");
      const code = urlParams.get("code") || hashParams.get("code");
      const accessToken = urlParams.get("access_token") || hashParams.get("access_token");
      const refreshToken = urlParams.get("refresh_token") || hashParams.get("refresh_token");

      if (type === "recovery" && code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!isMounted) return;
        if (exchangeError) {
          setError(INVALID_RESET_LINK_MESSAGE);
          setInitializing(false);
          return;
        }
        router.replace("/settings?recovery=1");
        return;
      }

      if (type === "recovery" && accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!isMounted) return;
        if (sessionError) {
          setError(INVALID_RESET_LINK_MESSAGE);
          setInitializing(false);
          return;
        }
        router.replace("/settings?recovery=1");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (sessionData.session) {
        router.replace("/settings?recovery=1");
      } else {
        setError(INVALID_RESET_LINK_MESSAGE);
        setInitializing(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        router.replace("/settings?recovery=1");
      }
    });

    initializeRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="bg-black/60 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-purple-900 flex flex-col gap-4 w-full max-w-md">
        <h1 className="glow-text text-3xl mb-2 text-center">Reset Password</h1>
        {error ? (
          <>
            <p className="text-center text-sm text-rose-300">{error}</p>
            <Link
              href="/forgot-password"
              className="block text-center text-sm text-pink-300 underline hover:text-pink-200"
            >
              Request a new reset link
            </Link>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-pink-300" size={28} />
            <p className="text-center text-slate-300">Verifying your reset link...</p>
          </div>
        )}
      </div>
    </div>
  );
}
