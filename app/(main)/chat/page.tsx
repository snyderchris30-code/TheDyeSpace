"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { createClient } from "@/lib/supabase/client";
import { canAccessSmokeLounge } from "@/lib/verified-seller";
import GlobalChatClient from "./GlobalChatClient";

export default function Page() {
  const [canAccessRoom2, setCanAccessRoom2] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    resolveClientAuth(supabase).then(async ({ user }) => {
      if (!user) {
        setCanAccessRoom2(false);
        return;
      }

      const profile = await fetchClientProfile<{ role?: string | null; verified_badge?: boolean | null; smoke_room_2_invited?: boolean | null }>(
        supabase,
        user.id,
        "role, verified_badge, smoke_room_2_invited",
        { ensureProfile: true }
      );

      setCanAccessRoom2(canAccessSmokeLounge(profile));
    });
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4">
      <div className="mt-6 mb-4 flex flex-wrap items-center gap-3">
        <Link
          href="/chat"
          prefetch={false}
          className="rounded-full border border-cyan-300/40 bg-cyan-900/30 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-900/45"
        >
          The Dye Chat
        </Link>
        {canAccessRoom2 ? (
          <Link
            href="/chat/smoke-room-2"
            prefetch={false}
            className="rounded-full border border-red-300/40 bg-red-900/30 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/45"
          >
            The Smoke Lounge 2.0
          </Link>
        ) : null}
      </div>

      <GlobalChatClient />
    </div>
  );
}
