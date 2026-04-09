"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AsyncStateCard from "@/app/AsyncStateCard";
import SmokeRoom2Client from "../SmokeRoom2Client";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { createClient } from "@/lib/supabase/client";
import { canAccessSmokeLounge } from "@/lib/verified-seller";

export default function SmokeRoom2PageClient() {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const supabase = createClient();
        setError(null);
        const { user, errorMessage } = await resolveClientAuth(supabase);
        if (!user) {
          setAllowed(false);
          if (errorMessage) {
            setError(errorMessage);
          }
          setLoading(false);
          return;
        }

        const profile = await fetchClientProfile<{ role?: string | null; verified_badge?: boolean | null; smoke_room_2_invited?: boolean | null }>(
          supabase,
          user.id,
          "role, verified_badge, smoke_room_2_invited",
          { ensureProfile: true }
        );

        setAllowed(canAccessSmokeLounge(profile));
      } catch (loadError: any) {
        setAllowed(false);
        setError(typeof loadError?.message === "string" ? loadError.message : "Could not verify access to The Smoke Lounge 2.0.");
      } finally {
        setLoading(false);
      }
    };

    void checkAccess();
  }, [retryKey]);

  if (loading) {
    return (
      <div className="mx-auto mt-10 max-w-2xl px-4">
        <AsyncStateCard
          loading
          title="Loading The Smoke Lounge 2.0"
          message="Checking your invite status before opening the private room."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-2xl px-4">
        <AsyncStateCard
          tone="error"
          title="Couldn\'t open The Smoke Lounge 2.0"
          message={error}
          actionLabel="Try again"
          onAction={() => {
            setLoading(true);
            setRetryKey((current) => current + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/chat"
          className="rounded-full border border-cyan-300/40 bg-cyan-900/30 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-900/45"
        >
          The Dye Chat
        </Link>
        {allowed ? (
          <Link
            href="/chat/smoke-room-2"
            className="rounded-full border border-red-300/40 bg-red-900/30 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/45"
          >
            The Smoke Lounge 2.0
          </Link>
        ) : null}
      </div>

      <SmokeRoom2Client allowed={allowed} />
    </div>
  );
}