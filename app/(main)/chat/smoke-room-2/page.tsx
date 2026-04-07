"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import AsyncStateCard from "@/app/AsyncStateCard";
import { createClient } from "@/lib/supabase/client";

const SmokeRoom2Client = dynamic(() => import("../SmokeRoom2Client"), { ssr: false });

export default function SmokeRoom2Page() {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const supabase = createClient();
        setError(null);
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (!user) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role,smoke_room_2_invited")
          .eq("id", user.id)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message || "Could not verify access to Smoke Room 2.0.");
        }

        setAllowed(profile?.role === "admin" || profile?.smoke_room_2_invited === true);
      } catch (loadError: any) {
        setAllowed(false);
        setError(typeof loadError?.message === "string" ? loadError.message : "Could not verify access to Smoke Room 2.0.");
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
          title="Loading Smoke Room 2.0"
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
          title="Couldn\'t open Smoke Room 2.0"
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
      <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
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
            The Smoke Room 2.0
          </Link>
        ) : null}
      </div>

      <SmokeRoom2Client allowed={allowed} />
    </div>
  );
}
