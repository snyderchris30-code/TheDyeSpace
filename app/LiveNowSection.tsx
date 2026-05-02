"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { dedupeApiFetchJson } from "@/lib/dedupe-fetch";
import type { LiveSessionSummary } from "@/lib/live-stream";

type LiveSessionsResponse = {
  sessions?: LiveSessionSummary[];
  error?: string;
};

async function fetchLiveSessions() {
  const body = await dedupeApiFetchJson<LiveSessionsResponse>("/api/live/sessions", {
    cache: "no-store",
  });

  if (body?.error) {
    throw new Error(body.error);
  }

  return body.sessions || [];
}

function formatLiveDuration(startedAt: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(startedAt));
  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 60) return `${minutes}m live`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m live`;
}

export default function LiveNowSection({ className }: { className?: string }) {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["liveSessions"],
    queryFn: fetchLiveSessions,
    staleTime: 1000 * 10,
    refetchInterval: 1000 * 20,
  });

  if (!isLoading && sessions.length === 0) {
    return null;
  }

  return (
    <section className={className || "mb-6"}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-black text-rose-100 sm:text-2xl">Live Now</h2>
        <span className="rounded-full border border-rose-400/50 bg-rose-600/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-rose-100">
          LIVE
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(isLoading ? new Array(3).fill(null) : sessions).map((session, index) => {
          if (!session) {
            return (
              <div key={`skeleton-${index}`} className="h-28 animate-pulse rounded-2xl border border-rose-300/20 bg-black/25" />
            );
          }

          const href = session.username ? `/profile/${encodeURIComponent(session.username)}` : "/profile";

          return (
            <Link
              key={session.userId}
              href={href}
              className="group rounded-2xl border border-rose-300/35 bg-[linear-gradient(180deg,rgba(127,29,29,0.22),rgba(15,23,42,0.62))] p-3 shadow-[0_10px_30px_rgba(127,29,29,0.28)] transition hover:-translate-y-0.5 hover:border-rose-200/55"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-rose-200/60 bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  LIVE
                </span>
                <span className="text-xs text-rose-100/85">{formatLiveDuration(session.startedAt)}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-full border border-rose-200/45 bg-slate-900">
                  {session.avatarUrl ? (
                    <Image src={session.avatarUrl} alt="Live host" width={48} height={48} className="h-full w-full object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-rose-100">LIVE</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-rose-50">{session.displayName || session.username || "Verified Host"}</p>
                  <p className="truncate text-xs text-rose-100/80">{session.title}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
