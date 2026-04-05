"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sanitizeUsernameInput } from "@/lib/profile-identity";

export default function ProfilePage() {
  const router = useRouter();

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
      } catch (error) {
        console.error("Error redirecting to profile:", error);
        router.replace("/");
      }
    };

    void redirectToProfile();
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="text-center">
        <p className="text-slate-300 text-lg">Loading your profile...</p>
      </div>
    </div>
  );
}
