"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sanitizeUsernameInput } from "@/lib/profile-identity";

export default function ProfilePage() {
  const router = useRouter();
  const [redirectError, setRedirectError] = useState<string | null>(null);

  useEffect(() => {
    const redirectToProfile = async () => {
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;

        if (!user) {
          // Not logged in, redirect to login
          router.replace("/login?redirect=/profile");
          return;
        }

        // Get the user's username from their profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .limit(1)
          .maybeSingle();

        let username = sanitizeUsernameInput(profile?.username);

        // If the profile record does not exist yet, initialize it first,
        // then redirect using the saved username from the profiles table.
        if (username.length < 3) {
          const initRes = await fetch("/api/profile/init", { method: "POST" });
          if (initRes.ok) {
            const initBody = await initRes.json().catch(() => ({}));
            username = sanitizeUsernameInput(initBody?.profile?.username);
          }
        }

        if (username.length >= 3) {
          router.replace(`/profile/${encodeURIComponent(username)}`);
        } else {
          router.replace("/");
        }
      } catch (error: any) {
        console.error("Error redirecting to profile:", error);
        setRedirectError(
          typeof error?.message === "string"
            ? error.message
            : "Unable to redirect to your profile. Please refresh and try again."
        );
      }
    };

    void redirectToProfile();
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div>
        {redirectError ? (
          <>
            <h1 className="text-2xl font-semibold text-rose-100">Unable to load profile</h1>
            <p className="mt-3 text-sm text-rose-200">{redirectError}</p>
            <button
              type="button"
              className="mt-4 rounded-full border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15"
              onClick={() => {
                setRedirectError(null);
                void router.refresh();
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <p className="text-slate-300 text-lg">Loading your profile...</p>
        )}
      </div>
    </div>
  );
}
