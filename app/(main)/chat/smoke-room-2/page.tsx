"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SmokeRoom2Client = dynamic(() => import("../SmokeRoom2Client"), { ssr: false });

export default function SmokeRoom2Page() {
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        setAllowed(false);
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role,smoke_room_2_invited")
        .eq("id", user.id)
        .maybeSingle();

      setAllowed(profile?.role === "admin" || profile?.smoke_room_2_invited === true);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-center text-cyan-200 mt-10">Loading...</div>;

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
