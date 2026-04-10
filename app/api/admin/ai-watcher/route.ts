import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

type ModerationFlagStatus = "open" | "reviewed" | "dismissed";

type RawFlagRecord = {
  id: string;
  entity_type: string;
  entity_id: string;
  content_url: string;
  excerpt: string | null;
  reason: string;
  categories: string[] | null;
  confidence_score: number | string;
  source_created_at: string;
  status: ModerationFlagStatus | string;
  last_seen_at: string;
  metadata: Record<string, unknown> | null;
};

type RawDailyReportRecord = {
  id: string;
  report_date: string;
  summary: string;
  flagged_count: number;
  open_flag_count: number;
  category_counts: Record<string, number> | null;
  top_items: Array<Record<string, unknown>> | null;
  created_at: string;
};

type RawRunRecord = {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  scanned_posts: number;
  scanned_comments: number;
  scanned_reactions: number;
  scanned_profiles: number;
  flagged_count: number;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
};

type WatcherRunResponse = {
  ok?: boolean;
  error?: string;
  runId?: string;
  trigger?: string;
  dailyReportDate?: string;
  dailyReportCreated?: boolean;
  notificationSent?: boolean;
  scanned?: {
    scannedPosts?: number;
    scannedComments?: number;
    scannedReactions?: number;
    scannedProfiles?: number;
    flaggedCount?: number;
  };
};

function jsonError(message: string, status: number, code: ApiErrorCode) {
  return NextResponse.json(
    { error: message, code },
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

function jsonOk(payload: Record<string, unknown>) {
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeScore(value: number | string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

function normalizeStatus(value: string): ModerationFlagStatus {
  if (value === "reviewed" || value === "dismissed") {
    return value;
  }

  return "open";
}

function normalizeIdentity(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      id: null,
      username: null,
      displayName: "Unknown user",
    };
  }

  const candidate = value as {
    id?: unknown;
    username?: unknown;
    displayName?: unknown;
  };

  return {
    id: typeof candidate.id === "string" ? candidate.id : null,
    username: typeof candidate.username === "string" ? candidate.username : null,
    displayName: typeof candidate.displayName === "string" && candidate.displayName.trim()
      ? candidate.displayName
      : typeof candidate.username === "string" && candidate.username.trim()
        ? `@${candidate.username.replace(/^@+/, "")}`
        : "Unknown user",
  };
}

async function requireAdmin(req: NextRequest, requestContext: Record<string, unknown>) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("admin/ai-watcher", "Unauthorized AI watcher request", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return { error: jsonError("Unauthorized", 401, "UNAUTHORIZED") };
    }

    const adminClient = createAdminClient();
    const isAdmin = await userIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      logWarn("admin/ai-watcher", "Forbidden AI watcher request", {
        ...requestContext,
        userId: user.id,
      });
      return { error: jsonError("Forbidden", 403, "FORBIDDEN") };
    }

    return { adminClient, user };
  } catch (error: any) {
    logError("admin/ai-watcher", "Failed to validate admin access", error, requestContext);
    return {
      error: jsonError(
        typeof error?.message === "string" ? error.message : "Failed to validate admin access.",
        500,
        "INTERNAL_ERROR"
      ),
    };
  }
}

export async function GET(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "admin/ai-watcher");
  try {
    const auth = await requireAdmin(req, requestContext);
    if (auth.error) {
      return auth.error;
    }

    const { adminClient, user } = auth;
    logInfo("admin/ai-watcher", "Loading AI watcher dashboard data", {
      ...requestContext,
      adminUserId: user.id,
    });

    const [flagsResult, dailyReportsResult, runsResult] = await Promise.all([
      adminClient
        .from("moderation_flags")
        .select("id, entity_type, entity_id, content_url, excerpt, reason, categories, confidence_score, source_created_at, status, last_seen_at, metadata")
        .neq("status", "dismissed")
        .order("last_seen_at", { ascending: false })
        .limit(30),
      adminClient
        .from("moderation_daily_reports")
        .select("id, report_date, summary, flagged_count, open_flag_count, category_counts, top_items, created_at")
        .order("report_date", { ascending: false })
        .limit(7),
      adminClient
        .from("moderation_watch_runs")
        .select("id, started_at, completed_at, status, provider, model, scanned_posts, scanned_comments, scanned_reactions, scanned_profiles, flagged_count, error_message, metadata")
        .order("started_at", { ascending: false })
        .limit(8),
    ]);

    if (flagsResult.error) {
      throw flagsResult.error;
    }
    if (dailyReportsResult.error) {
      throw dailyReportsResult.error;
    }
    if (runsResult.error) {
      throw runsResult.error;
    }

    const flags = ((flagsResult.data || []) as RawFlagRecord[]).map((flag) => {
      const metadata = flag.metadata && typeof flag.metadata === "object" ? flag.metadata : {};

      return {
        id: flag.id,
        entityType: flag.entity_type,
        entityId: flag.entity_id,
        contentUrl: flag.content_url,
        excerpt: flag.excerpt,
        reason: flag.reason,
        categories: Array.isArray(flag.categories)
          ? flag.categories.filter((value): value is string => typeof value === "string")
          : [],
        confidenceScore: normalizeScore(flag.confidence_score),
        sourceCreatedAt: flag.source_created_at,
        lastSeenAt: flag.last_seen_at,
        status: normalizeStatus(flag.status),
        actor: normalizeIdentity((metadata as { actor?: unknown }).actor),
        author: normalizeIdentity((metadata as { author?: unknown }).author),
        metadata,
      };
    });

    const dailyReports = ((dailyReportsResult.data || []) as RawDailyReportRecord[]).map((report) => ({
      id: report.id,
      reportDate: report.report_date,
      summary: report.summary,
      flaggedCount: report.flagged_count,
      openFlagCount: report.open_flag_count,
      categoryCounts: report.category_counts || {},
      topItems: Array.isArray(report.top_items) ? report.top_items : [],
      createdAt: report.created_at,
    }));

    const recentRuns = ((runsResult.data || []) as RawRunRecord[]).map((run) => ({
      id: run.id,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      status: run.status,
      provider: run.provider,
      model: run.model,
      scannedPosts: run.scanned_posts,
      scannedComments: run.scanned_comments,
      scannedReactions: run.scanned_reactions,
      scannedProfiles: run.scanned_profiles,
      flaggedCount: run.flagged_count,
      errorMessage: run.error_message,
      metadata: run.metadata || {},
    }));

    logInfo("admin/ai-watcher", "Loaded AI watcher dashboard data", {
      ...requestContext,
      adminUserId: user.id,
      flagCount: flags.length,
      reportCount: dailyReports.length,
      runCount: recentRuns.length,
    });

    return jsonOk({
      flags,
      dailyReports,
      lastRun: recentRuns[0] || null,
      recentRuns,
    });
  } catch (error: any) {
    logError("admin/ai-watcher", "Failed to load AI watcher dashboard data", error, requestContext);
    return jsonError(
      typeof error?.message === "string" ? error.message : "Failed to load AI watcher data.",
      500,
      "INTERNAL_ERROR"
    );
  }
}

export async function PATCH(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "admin/ai-watcher");
  try {
    const auth = await requireAdmin(req, requestContext);
    if (auth.error) {
      return auth.error;
    }

    const { adminClient, user } = auth;
    const body = (await req.json().catch(() => ({}))) as {
      flagId?: string;
      status?: ModerationFlagStatus;
    };

    if (!body.flagId || !body.status || !["open", "reviewed", "dismissed"].includes(body.status)) {
      return jsonError("Invalid AI watcher action.", 400, "BAD_REQUEST");
    }

    const updatePayload = body.status === "open"
      ? {
          status: "open",
          reviewed_at: null,
          reviewed_by: null,
        }
      : {
          status: body.status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        };

    const { error } = await adminClient
      .from("moderation_flags")
      .update(updatePayload)
      .eq("id", body.flagId);

    if (error) {
      throw error;
    }

    logInfo("admin/ai-watcher", "Updated AI watcher flag status", {
      ...requestContext,
      adminUserId: user.id,
      flagId: body.flagId,
      status: body.status,
    });

    return jsonOk({ success: true });
  } catch (error: any) {
    logError("admin/ai-watcher", "Failed to update AI watcher flag", error, requestContext);
    return jsonError(
      typeof error?.message === "string" ? error.message : "Failed to update the AI watcher flag.",
      500,
      "INTERNAL_ERROR"
    );
  }
}

function parseWatcherRunResponse(payload: unknown): WatcherRunResponse {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return payload as WatcherRunResponse;
}

function buildWatcherNotificationMessage(result: WatcherRunResponse) {
  const scannedPosts = result.scanned?.scannedPosts ?? 0;
  const scannedComments = result.scanned?.scannedComments ?? 0;
  const scannedReactions = result.scanned?.scannedReactions ?? 0;
  const scannedProfiles = result.scanned?.scannedProfiles ?? 0;
  const flaggedCount = result.scanned?.flaggedCount ?? 0;

  return `Manual AI watcher test finished. Scanned ${scannedPosts} posts, ${scannedComments} comments, ${scannedReactions} reactions, and ${scannedProfiles} profiles. Flagged ${flaggedCount} item${flaggedCount === 1 ? "" : "s"}.${result.dailyReportDate ? ` Daily report: ${result.dailyReportDate}.` : ""}`;
}

async function insertAdminNotification(adminClient: ReturnType<typeof createAdminClient>, userId: string, message: string) {
  const { error } = await adminClient
    .from("notifications")
    .insert({
      user_id: userId,
      actor_name: "AI Watcher Bot",
      type: "comment",
      message,
    });

  if (error) {
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "admin/ai-watcher");
  try {
    const auth = await requireAdmin(req, requestContext);
    if (auth.error) {
      return auth.error;
    }

    const { adminClient, user } = auth;
    const body = (await req.json().catch(() => ({}))) as {
      notifyAdmin?: boolean;
    };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const cronToken = process.env.AI_WATCHER_CRON_TOKEN?.trim() || null;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError("AI watcher is missing required runtime secrets.", 500, "INTERNAL_ERROR");
    }

    const watcherUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ai-watcher`;
    const notifyAdmin = body.notifyAdmin !== false;

    logInfo("admin/ai-watcher", "Triggering manual AI watcher run", {
      ...requestContext,
      adminUserId: user.id,
      watcherUrl,
      notifyAdmin,
    });

    const watcherResponse = await fetch(watcherUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        ...(cronToken ? { "x-ai-watcher-cron-token": cronToken } : {}),
      },
      body: JSON.stringify({
        trigger: "admin_dashboard",
        requestedByUserId: user.id,
        notifyAdmin,
        notifyAdminUserId: user.id,
        note: "Triggered from the admin moderation dashboard.",
      }),
      cache: "no-store",
    });

    const watcherBody = parseWatcherRunResponse(await watcherResponse.json().catch(() => ({})));

    if (!watcherResponse.ok || watcherBody.ok === false) {
      throw new Error(watcherBody.error || "Failed to run the AI watcher.");
    }

    if (notifyAdmin && !watcherBody.notificationSent) {
      await insertAdminNotification(adminClient, user.id, buildWatcherNotificationMessage(watcherBody));
    }

    logInfo("admin/ai-watcher", "Manual AI watcher run completed", {
      ...requestContext,
      adminUserId: user.id,
      runId: watcherBody.runId ?? null,
      notificationSent: notifyAdmin,
    });

    return jsonOk({
      success: true,
      message: notifyAdmin
        ? "AI watcher test run completed and an admin notification was sent."
        : "AI watcher test run completed.",
      result: watcherBody,
    });
  } catch (error: any) {
    logError("admin/ai-watcher", "Failed to trigger manual AI watcher run", error, requestContext);
    return jsonError(
      typeof error?.message === "string" ? error.message : "Failed to trigger the AI watcher.",
      500,
      "INTERNAL_ERROR"
    );
  }
}