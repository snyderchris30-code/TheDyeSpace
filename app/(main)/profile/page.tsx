"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ProfilePage() {
  const router = useRouter();

  useEffect(() => {
    const redirectToProfile = async () => {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;

      if (!user) {
        // Not logged in, redirect to login
        router.push("/login?redirect=/profile");
        return;
      }

      // Get the user's username from their profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      const username = profile?.username || user.email;
      if (username) {
        router.push(`/profile/${encodeURIComponent(username)}`);
      } else {
        router.push("/");
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
