"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AsyncStateCard from "@/app/AsyncStateCard";
import { createClient } from "@/lib/supabase/client";

type ModerationReport = {
  id: string;
  type: "post" | "comment";
  reason: string;
  createdAt: string;
  targetId: string;
  postId: string | null;
  deletedAt: string | null;
  targetMissing: boolean;
  preview: string;
  parentPostPreview: string | null;
  reporter: {
    id: string | null;
    username: string | null;
    displayName: string;
  };
  targetAuthor: {
    id: string | null;
    username: string | null;
    displayName: string;
  };
};

type StatusState = {
  type: "success" | "error";
  text: string;
};

function formatIdentity(displayName: string, username: string | null) {
  if (username) {
    return `${displayName} (@${username.replace(/^@+/, "")})`;
  }

  return displayName;
}

export default function AdminReportsClient() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        setReports([]);
        setError("Please sign in to review reports.");
        setIsAdmin(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .limit(1)
        .maybeSingle();

      if (profileError) {
        throw new Error(profileError.message || "Could not verify your admin access.");
      }

      const admin = profile?.role === "admin";
      setIsAdmin(admin);

      if (!admin) {
        setReports([]);
        setError("Admin access only.");
        return;
      }

      const response = await fetch("/api/admin/reports", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body?.error || "Failed to load moderation reports.");
      }

      setReports(Array.isArray(body?.reports) ? body.reports : []);
    } catch (loadError: any) {
      setReports([]);
      setError(typeof loadError?.message === "string" ? loadError.message : "Failed to load moderation reports.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const dismissReport = useCallback(async (reportId: string) => {
    setBusyId(reportId);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", reportId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to dismiss report.");
      }

      setReports((current) => current.filter((report) => report.id !== reportId));
      setStatus({ type: "success", text: "Report dismissed." });
    } catch (dismissError: any) {
      setStatus({
        type: "error",
        text: typeof dismissError?.message === "string" ? dismissError.message : "Failed to dismiss report.",
      });
    } finally {
      setBusyId(null);
    }
  }, []);

  const deleteReportedContent = useCallback(async (report: ModerationReport) => {
    setBusyId(report.id);
    setStatus(null);

    try {
      const deleteUrl = report.type === "post"
        ? `/api/posts/manage?postId=${encodeURIComponent(report.targetId)}`
        : report.postId
          ? `/api/posts/comments?commentId=${encodeURIComponent(report.targetId)}&postId=${encodeURIComponent(report.postId)}`
          : null;

      if (!deleteUrl) {
        throw new Error("This report is missing the content details needed for deletion.");
      }

      const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });
      const deleteBody = await deleteResponse.json().catch(() => ({}));
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        throw new Error(deleteBody?.error || "Failed to delete the reported content.");
      }

      const dismissResponse = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_target", targetId: report.targetId, reportType: report.type }),
      });
      const dismissBody = await dismissResponse.json().catch(() => ({}));
      if (!dismissResponse.ok) {
        throw new Error(dismissBody?.error || "Content was removed, but the report queue could not be cleared.");
      }

      setReports((current) => current.filter((item) => !(item.type === report.type && item.targetId === report.targetId)));
      setStatus({ type: "success", text: report.type === "post" ? "Reported post removed and cleared from the queue." : "Reported comment removed and cleared from the queue." });
    } catch (deleteError: any) {
      setStatus({
        type: "error",
        text: typeof deleteError?.message === "string" ? deleteError.message : "Failed to delete the reported content.",
      });
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-8 text-cyan-100">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/70">Admin</p>
          <h1 className="mt-2 text-3xl font-bold text-cyan-50">Moderation Queue</h1>
          <p className="mt-2 text-sm text-cyan-100/70">Review reports for posts and comments in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/deleted-items" className="rounded-full border border-amber-300/35 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/20">
            Deleted Items
          </Link>
          <Link href="/" className="rounded-full border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/20">
            Back Home
          </Link>
        </div>
      </div>

      {status ? (
        <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${status.type === "success" ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100" : "border-rose-300/30 bg-rose-500/15 text-rose-100"}`}>
          {status.text}
        </div>
      ) : null}

      {loading ? (
        <AsyncStateCard
          loading
          title="Loading moderation queue"
          message="Gathering reports, reporter details, and the content that was flagged."
        />
      ) : error ? (
        <AsyncStateCard
          tone="error"
          title="Couldn\'t load moderation reports"
          message={error}
          actionLabel={isAdmin ? "Retry queue" : undefined}
          onAction={isAdmin ? () => void loadReports() : undefined}
        />
      ) : reports.length === 0 ? (
        <AsyncStateCard
          title="No reports waiting"
          message="The moderation queue is clear right now. New post and comment reports will show up here automatically."
        />
      ) : (
        <div className="space-y-4">
          {reports.map((report) => {
            const isBusy = busyId === report.id;

            return (
              <article key={report.id} className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/60 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${report.type === "post" ? "border border-cyan-300/35 bg-cyan-400/10 text-cyan-100" : "border border-pink-300/35 bg-pink-500/10 text-pink-100"}`}>
                      {report.type}
                    </span>
                    {report.deletedAt ? (
                      <span className="rounded-full border border-amber-300/35 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
                        Already deleted
                      </span>
                    ) : null}
                    {report.targetMissing ? (
                      <span className="rounded-full border border-rose-300/35 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100">
                        Content unavailable
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-cyan-100/55">Reported {new Date(report.createdAt).toLocaleString()}</div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-pink-300/20 bg-pink-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-pink-200/75">Reason</p>
                      <p className="mt-2 text-sm leading-6 text-pink-50">{report.reason}</p>
                    </div>

                    <div className="rounded-2xl border border-cyan-300/15 bg-black/25 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/75">Reported by</p>
                      <p className="mt-2 text-sm text-cyan-50">{formatIdentity(report.reporter.displayName, report.reporter.username)}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-cyan-300/75">Content author</p>
                      <p className="mt-2 text-sm text-cyan-50">{formatIdentity(report.targetAuthor.displayName, report.targetAuthor.username)}</p>
                    </div>

                    <div className="rounded-2xl border border-cyan-300/15 bg-black/25 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/75">Flagged content</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-50">{report.preview}</p>
                      {report.parentPostPreview ? (
                        <div className="mt-4 rounded-xl border border-cyan-300/10 bg-cyan-950/35 p-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">Parent post</p>
                          <p className="mt-2 text-sm text-cyan-100/85">{report.parentPostPreview}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-row gap-2 lg:flex-col lg:justify-start">
                    <button
                      type="button"
                      className="rounded-full border border-rose-300/35 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void deleteReportedContent(report)}
                      disabled={isBusy || report.targetMissing || Boolean(report.deletedAt)}
                    >
                      {isBusy ? "Working..." : report.deletedAt ? "Already deleted" : "Delete content"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void dismissReport(report.id)}
                      disabled={isBusy}
                    >
                      {isBusy ? "Working..." : "Dismiss report"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}