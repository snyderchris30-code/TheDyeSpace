"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AsyncStateCard from "@/app/AsyncStateCard";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { createClient } from "@/lib/supabase/client";
import { sanitizeUsernameInput } from "@/lib/profile-identity";

export default function ProfilePage() {
  const router = useRouter();
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const redirectToProfile = async () => {
      try {
        const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const edit = params?.get("edit") === "1";
        const welcome = params?.get("welcome") === "1";
        const suffix = `${edit ? "?edit=1" : ""}${edit && welcome ? "&" : !edit && welcome ? "?" : ""}${welcome ? "welcome=1" : ""}`;
        const supabase = createClient();
        const authState = await resolveClientAuth(supabase);
        const user = authState.user;

        if (!user) {
          router.replace("/login?redirect=/profile");
          return;
        }

        const profile = await fetchClientProfile<{ username?: string | null }>(supabase, user.id, "username", {
          ensureProfile: true,
        });

        let username = sanitizeUsernameInput(profile?.username);

        if (username.length >= 3) {
          router.replace(`/profile/${encodeURIComponent(username)}${suffix}`);
        } else {
          throw new Error(authState.errorMessage || "Your profile could not be initialized. Please log in again.");
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
  }, [retryKey, router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="w-full max-w-2xl">
        {redirectError ? (
          <AsyncStateCard
            tone="error"
            title="Couldn\'t load profile"
            message={redirectError}
            actionLabel="Retry"
            onAction={() => {
              setRedirectError(null);
              setRetryKey((current) => current + 1);
            }}
          />
        ) : (
          <AsyncStateCard
            loading
            title="Loading your profile"
            message="Checking your account and redirecting you to the right profile page now."
          />
        )}
      </div>
    </div>
  );
}
