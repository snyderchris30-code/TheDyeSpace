"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AsyncStateCard from "@/app/AsyncStateCard";
import { createClient } from "@/lib/supabase/client";
import { hasAdminAccess } from "@/lib/admin-actions";

type ModerationReport = {
  id: string;
  type: "post" | "comment" | "user";
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

type WatcherFlag = {
  id: string;
  entityType: string;
  entityId: string;
  contentUrl: string;
  excerpt: string | null;
  reason: string;
  categories: string[];
  confidenceScore: number;
  sourceCreatedAt: string;
  lastSeenAt: string;
  status: "open" | "reviewed" | "dismissed";
  actor: {
    id: string | null;
    username: string | null;
    displayName: string;
  };
  author: {
    id: string | null;
    username: string | null;
    displayName: string;
  };
};

type WatcherDailyReport = {
  id: string;
  reportDate: string;
  summary: string;
  flaggedCount: number;
  openFlagCount: number;
  categoryCounts: Record<string, number>;
  topItems: Array<{
    entityType?: string;
    contentUrl?: string;
    excerpt?: string | null;
    reason?: string;
    confidenceScore?: number;
  }>;
  createdAt: string;
};

type WatcherRun = {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  scannedPosts: number;
  scannedComments: number;
  scannedReactions: number;
  scannedProfiles: number;
  flaggedCount: number;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
};

async function parseApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.toLowerCase().includes("application/json")) {
    return response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => "");
  return {
    error: text?.trim() ? "Unexpected non-JSON response from server." : null,
  };
}

function formatIdentity(displayName: string, username: string | null) {
  if (username) {
    return `${displayName} (@${username.replace(/^@+/, "")})`;
  }

  return displayName;
}

function formatCategoryLabel(value: string) {
  switch (value) {
    case "drug_or_illegal":
      return "Drug / Illegal";
    case "spam_scam_impersonation":
      return "Spam / Scam / Impersonation";
    case "hate_or_harassment":
      return "Hate / Harassment";
    case "community_suspicious":
      return "Community Suspicious";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatFlagStatus(value: WatcherFlag["status"]) {
  if (value === "reviewed") return "Reviewed";
  if (value === "dismissed") return "Dismissed";
  return "Open";
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatRunTrigger(metadata: Record<string, unknown>) {
  const trigger = typeof metadata.trigger === "string" ? metadata.trigger : "";
  if (trigger === "pg_cron") return "Scheduled 30-minute run";
  if (trigger === "admin_dashboard") return "Manual dashboard test";
  if (trigger) return trigger.replace(/_/g, " ");
  return "Unknown trigger";
}

export default function AdminReportsClient() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [watcherFlags, setWatcherFlags] = useState<WatcherFlag[]>([]);
  const [dailyReports, setDailyReports] = useState<WatcherDailyReport[]>([]);
  const [recentRuns, setRecentRuns] = useState<WatcherRun[]>([]);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyFlagId, setBusyFlagId] = useState<string | null>(null);
  const [triggeringWatcher, setTriggeringWatcher] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWatcherError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        setReports([]);
        setWatcherFlags([]);
        setDailyReports([]);
        setRecentRuns([]);
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

      const admin = hasAdminAccess(userId, profile?.role ?? null);
      setIsAdmin(admin);

      if (!admin) {
        setReports([]);
        setWatcherFlags([]);
        setDailyReports([]);
        setRecentRuns([]);
        setError("Admin access only.");
        return;
      }

      const [reportsResponse, watcherResponse] = await Promise.all([
        fetch("/api/admin/reports", { cache: "no-store" }),
        fetch("/api/admin/ai-watcher", { cache: "no-store" }),
      ]);

      const [reportsBody, watcherBody] = await Promise.all([
        parseApiResponse(reportsResponse),
        parseApiResponse(watcherResponse),
      ]);

      if (!reportsResponse.ok) {
        throw new Error(reportsBody?.error || "Failed to load moderation reports.");
      }

      setReports(Array.isArray(reportsBody?.reports) ? reportsBody.reports : []);

      if (!watcherResponse.ok) {
        setWatcherFlags([]);
        setDailyReports([]);
        setRecentRuns([]);
        setWatcherError(watcherBody?.error || "Failed to load AI watcher data.");
      } else {
        setWatcherFlags(Array.isArray(watcherBody?.flags) ? watcherBody.flags : []);
        setDailyReports(Array.isArray(watcherBody?.dailyReports) ? watcherBody.dailyReports : []);
        setRecentRuns(Array.isArray(watcherBody?.recentRuns) ? watcherBody.recentRuns : []);
      }
    } catch (loadError: any) {
      setReports([]);
      setWatcherFlags([]);
      setDailyReports([]);
      setRecentRuns([]);
      let message = "Failed to load moderation reports.";
      if (typeof loadError?.message === "string") {
        if (loadError.message.includes("Failed to fetch")) {
          message = "Could not connect to the moderation API. Please check your network connection or try again later.";
        } else {
          message = loadError.message;
        }
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const dismissReport = useCallback(async (reportId: string) => {
    setBusyReportId(reportId);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss", reportId }),
      });
      const body = await parseApiResponse(response);
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
      setBusyReportId(null);
    }
  }, []);

  const deleteReportedContent = useCallback(async (report: ModerationReport) => {
    setBusyReportId(report.id);
    setStatus(null);

    try {
      if (report.type === "user") {
        const dismissResponse = await fetch("/api/admin/reports", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dismiss_target", targetId: report.targetId, reportType: report.type }),
        });
        const dismissBody = await parseApiResponse(dismissResponse);
        if (!dismissResponse.ok) {
          throw new Error(dismissBody?.error || "Failed to clear profile reports.");
        }

        setReports((current) => current.filter((item) => !(item.type === report.type && item.targetId === report.targetId)));
        setStatus({ type: "success", text: "Profile reports cleared from the queue." });
        return;
      }

      const deleteUrl = report.type === "post"
        ? `/api/posts/manage?postId=${encodeURIComponent(report.targetId)}`
        : report.postId
          ? `/api/posts/comments?commentId=${encodeURIComponent(report.targetId)}&postId=${encodeURIComponent(report.postId)}`
          : null;

      if (!deleteUrl) {
        throw new Error("This report is missing the content details needed for deletion.");
      }

      const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });
      const deleteBody = await parseApiResponse(deleteResponse);
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        throw new Error(deleteBody?.error || "Failed to delete the reported content.");
      }

      const dismissResponse = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss_target", targetId: report.targetId, reportType: report.type }),
      });
      const dismissBody = await parseApiResponse(dismissResponse);
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
      setBusyReportId(null);
    }
  }, []);

  const updateWatcherFlagStatus = useCallback(async (flagId: string, nextStatus: WatcherFlag["status"]) => {
    setBusyFlagId(flagId);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/ai-watcher", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId, status: nextStatus }),
      });
      const body = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(body?.error || "Failed to update AI watcher flag.");
      }

      setWatcherFlags((current) => current
        .map((flag) => (flag.id === flagId ? { ...flag, status: nextStatus } : flag))
        .filter((flag) => flag.status !== "dismissed"));
      setStatus({
        type: "success",
        text: nextStatus === "reviewed" ? "AI flag marked as reviewed." : "AI flag dismissed.",
      });
    } catch (flagError: any) {
      setStatus({
        type: "error",
        text: typeof flagError?.message === "string" ? flagError.message : "Failed to update the AI watcher flag.",
      });
    } finally {
      setBusyFlagId(null);
    }
  }, []);

  const triggerWatcherTest = useCallback(async () => {
    setTriggeringWatcher(true);
    setStatus(null);
    setWatcherError(null);

    try {
      const response = await fetch("/api/admin/ai-watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyAdmin: true }),
      });
      const body = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(body?.error || "Failed to run the AI watcher test.");
      }

      await loadReports();
      setStatus({
        type: "success",
        text: typeof body?.message === "string" ? body.message : "AI watcher test run completed.",
      });
    } catch (triggerError: any) {
      setStatus({
        type: "error",
        text: typeof triggerError?.message === "string" ? triggerError.message : "Failed to run the AI watcher test.",
      });
    } finally {
      setTriggeringWatcher(false);
    }
  }, [loadReports]);

  const openFlagCount = watcherFlags.filter((flag) => flag.status === "open").length;
  const lastRun = recentRuns[0] || null;

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

      {!loading && isAdmin ? (
        <section className="mb-8 rounded-[1.9rem] border border-emerald-300/20 bg-emerald-950/30 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-emerald-200/70">AI Watcher</p>
              <h2 className="mt-2 text-2xl font-bold text-emerald-50">Automated Signals</h2>
              <p className="mt-2 text-sm text-emerald-100/75">Every 30 minutes the bot reviews new posts, comments, reactions, and profiles, then stores a daily admin summary.</p>
            </div>
            <div className="flex flex-col items-stretch gap-3">
              <button
                type="button"
                className="rounded-full border border-emerald-300/35 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void triggerWatcherTest()}
                disabled={triggeringWatcher}
              >
                {triggeringWatcher ? "Running AI watcher..." : "Run AI Watcher Test"}
              </button>
              {lastRun ? (
                <div className="rounded-2xl border border-emerald-300/20 bg-black/25 px-4 py-3 text-sm text-emerald-100/85">
                  <div className="font-semibold text-emerald-50">Last run: {new Date(lastRun.startedAt).toLocaleString()}</div>
                  <div className="mt-1">Status: {lastRun.status}</div>
                  <div>Trigger: {formatRunTrigger(lastRun.metadata)}</div>
                  <div>Scanned {lastRun.scannedPosts} posts, {lastRun.scannedComments} comments, {lastRun.scannedReactions} reactions, {lastRun.scannedProfiles} profiles</div>
                  <div>Flagged {lastRun.flaggedCount} items{lastRun.provider ? ` using ${lastRun.provider}${lastRun.model ? ` / ${lastRun.model}` : ""}` : ""}</div>
                  {lastRun.errorMessage ? <div className="mt-1 text-rose-200">{lastRun.errorMessage}</div> : null}
                </div>
              ) : null}
            </div>
          </div>

          {watcherError ? (
            <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
              {watcherError}
            </div>
          ) : (
            <>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-300/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">Open flags</p>
                  <p className="mt-2 text-3xl font-bold text-emerald-50">{openFlagCount}</p>
                </div>
                <div className="rounded-2xl border border-emerald-300/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">Daily reports</p>
                  <p className="mt-2 text-3xl font-bold text-emerald-50">{dailyReports.length}</p>
                </div>
                <div className="rounded-2xl border border-emerald-300/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/70">Recent flagged items</p>
                  <p className="mt-2 text-3xl font-bold text-emerald-50">{watcherFlags.length}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-emerald-50">Daily summaries</h3>
                    <p className="mt-1 text-sm text-emerald-100/70">The bot writes one clean report per UTC day for the private admin dashboard.</p>
                  </div>
                  {dailyReports.length === 0 ? (
                    <div className="rounded-2xl border border-emerald-300/15 bg-black/20 p-4 text-sm text-emerald-100/75">
                      No daily AI summary has been stored yet.
                    </div>
                  ) : (
                    dailyReports.slice(0, 3).map((report) => (
                      <article key={report.id} className="rounded-2xl border border-emerald-300/15 bg-black/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-base font-semibold text-emerald-50">{new Date(`${report.reportDate}T00:00:00Z`).toLocaleDateString()}</h4>
                          <div className="text-xs text-emerald-100/65">Created {new Date(report.createdAt).toLocaleString()}</div>
                        </div>
                        <p className="mt-3 text-sm text-emerald-100/85">{report.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-emerald-100/80">
                          <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1">Flags: {report.flaggedCount}</span>
                          <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1">Open: {report.openFlagCount}</span>
                          {Object.entries(report.categoryCounts).map(([category, count]) => (
                            <span key={`${report.id}-${category}`} className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1">
                              {formatCategoryLabel(category)}: {count}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-emerald-50">Recent AI flags</h3>
                    <p className="mt-1 text-sm text-emerald-100/70">These are the latest automated moderation signals waiting on admin review.</p>
                  </div>
                  {watcherFlags.length === 0 ? (
                    <div className="rounded-2xl border border-emerald-300/15 bg-black/20 p-4 text-sm text-emerald-100/75">
                      No AI flags are open right now.
                    </div>
                  ) : (
                    watcherFlags.map((flag) => {
                      const isBusy = busyFlagId === flag.id;

                      return (
                        <article key={flag.id} className="rounded-2xl border border-emerald-300/15 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-50">
                                {flag.entityType.replace(/_/g, " ")}
                              </span>
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${flag.status === "reviewed" ? "border border-cyan-300/30 bg-cyan-500/10 text-cyan-100" : "border border-amber-300/30 bg-amber-500/10 text-amber-100"}`}>
                                {formatFlagStatus(flag.status)}
                              </span>
                              <span className="rounded-full border border-rose-300/25 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100">
                                {formatConfidence(flag.confidenceScore)}
                              </span>
                            </div>
                            <div className="text-xs text-emerald-100/60">Detected {new Date(flag.sourceCreatedAt).toLocaleString()}</div>
                          </div>

                          <p className="mt-3 text-sm font-semibold text-emerald-50">{flag.reason}</p>
                          {flag.excerpt ? <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-100/85">{flag.excerpt}</p> : null}

                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-emerald-100/80">
                            {flag.categories.map((category) => (
                              <span key={`${flag.id}-${category}`} className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1">
                                {formatCategoryLabel(category)}
                              </span>
                            ))}
                          </div>

                          <div className="mt-4 rounded-2xl border border-emerald-300/10 bg-emerald-950/30 p-3 text-sm text-emerald-100/85">
                            <p>Actor: {formatIdentity(flag.actor.displayName, flag.actor.username)}</p>
                            <p className="mt-1">Author: {formatIdentity(flag.author.displayName, flag.author.username)}</p>
                            <p className="mt-1">Last seen by watcher: {new Date(flag.lastSeenAt).toLocaleString()}</p>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link href={flag.contentUrl} className="rounded-full border border-emerald-300/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/20">
                              Open content
                            </Link>
                            <button
                              type="button"
                              className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => void updateWatcherFlagStatus(flag.id, "reviewed")}
                              disabled={isBusy || flag.status === "reviewed"}
                            >
                              {isBusy ? "Working..." : flag.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
                            </button>
                            <button
                              type="button"
                              className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => void updateWatcherFlagStatus(flag.id, "dismissed")}
                              disabled={isBusy}
                            >
                              {isBusy ? "Working..." : "Dismiss flag"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </section>
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
            const isBusy = busyReportId === report.id;

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
                    {report.type !== "user" ? (
                      <button
                        type="button"
                        className="rounded-full border border-rose-300/35 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void deleteReportedContent(report)}
                        disabled={isBusy || report.targetMissing || Boolean(report.deletedAt)}
                      >
                        {isBusy ? "Working..." : report.deletedAt ? "Already deleted" : "Delete content"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void (report.type === "user" ? deleteReportedContent(report) : dismissReport(report.id))}
                      disabled={isBusy}
                    >
                      {isBusy ? "Working..." : report.type === "user" ? "Dismiss profile reports" : "Dismiss report"}
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