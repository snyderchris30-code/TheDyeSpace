import { NextRequest, NextResponse } from "next/server";
import { ADMIN_USER_UID } from "@/lib/admin-actions";
import { createAdminClient } from "@/lib/admin-utils";
import { sendPushNotificationsForSources } from "@/lib/push-notifications";
import { applyRateLimit, getClientIp, hasSuspiciousInput, sanitizeUserText } from "@/lib/security/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ReportType = "post" | "comment";

type ReportBody = {
  type?: string;
  targetId?: string;
  reason?: string;
};

type ReportTargetContext = {
  postId: string | null;
  targetHandle: string | null;
};

function normalizeHandle(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim().replace(/^@+/, "") : "";
  return trimmed || null;
}

async function insertNotificationRecord(
  adminClient: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>
) {
  const { error } = await adminClient.from("notifications").insert(payload);

  if (!error) {
    return;
  }

  const cacheError = String(error.message || "").includes(
    "Could not find the 'post_id' column of 'notifications' in the schema cache"
  );

  if (cacheError && payload.post_id !== undefined) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.post_id;

    const { error: fallbackError } = await adminClient.from("notifications").insert(fallbackPayload);
    if (!fallbackError) {
      return;
    }

    throw fallbackError;
  }

  throw error;
}

async function getAdminRecipientIds(adminClient: ReturnType<typeof createAdminClient>) {
  const { data, error } = await adminClient.from("profiles").select("id").eq("role", "admin");

  if (error) {
    throw error;
  }

  const ids = new Set<string>([ADMIN_USER_UID]);
  for (const row of data || []) {
    if (typeof row?.id === "string" && row.id) {
      ids.add(row.id);
    }
  }

  return [...ids];
}

async function resolveReportTargetContext(
  adminClient: ReturnType<typeof createAdminClient>,
  type: ReportType,
  targetId: string
): Promise<ReportTargetContext> {
  if (type === "post") {
    const { data: post, error: postError } = await adminClient
      .from("posts")
      .select("id,user_id")
      .eq("id", targetId)
      .limit(1)
      .maybeSingle<{ id: string; user_id: string | null }>();

    if (postError) {
      throw postError;
    }

    if (!post) {
      throw new Error("That post could not be found.");
    }

    if (!post.user_id) {
      return { postId: post.id, targetHandle: null };
    }

    const { data: author, error: authorError } = await adminClient
      .from("profiles")
      .select("username,display_name")
      .eq("id", post.user_id)
      .limit(1)
      .maybeSingle<{ username: string | null; display_name: string | null }>();

    if (authorError) {
      throw authorError;
    }

    return {
      postId: post.id,
      targetHandle: normalizeHandle(author?.username) ?? normalizeHandle(author?.display_name),
    };
  }

  const { data: comment, error: commentError } = await adminClient
    .from("post_comments")
    .select("id,post_id,user_id")
    .eq("id", targetId)
    .limit(1)
    .maybeSingle<{ id: string; post_id: string | null; user_id: string | null }>();

  if (commentError) {
    throw commentError;
  }

  if (!comment) {
    throw new Error("That comment could not be found.");
  }

  if (!comment.user_id) {
    return { postId: comment.post_id ?? null, targetHandle: null };
  }

  const { data: author, error: authorError } = await adminClient
    .from("profiles")
    .select("username,display_name")
    .eq("id", comment.user_id)
    .limit(1)
    .maybeSingle<{ username: string | null; display_name: string | null }>();

  if (authorError) {
    throw authorError;
  }

  return {
    postId: comment.post_id ?? null,
    targetHandle: normalizeHandle(author?.username) ?? normalizeHandle(author?.display_name),
  };
}

async function createAdminReportNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  reportType: ReportType,
  targetId: string,
  reporterId: string
) {
  const [{ data: reporter, error: reporterError }, adminRecipientIds, targetContext] = await Promise.all([
    adminClient
      .from("profiles")
      .select("username,display_name")
      .eq("id", reporterId)
      .limit(1)
      .maybeSingle<{ username: string | null; display_name: string | null }>(),
    getAdminRecipientIds(adminClient),
    resolveReportTargetContext(adminClient, reportType, targetId),
  ]);

  if (reporterError) {
    throw reporterError;
  }

  const reporterHandle = normalizeHandle(reporter?.username) ?? normalizeHandle(reporter?.display_name) ?? "Report Alert";
  const targetLabel = targetContext.targetHandle ? ` by @${targetContext.targetHandle}` : "";
  const message =
    reportType === "post"
      ? `New report on post${targetLabel}. Open the Moderation Queue.`
      : `New report on comment${targetLabel}. Open the Moderation Queue.`;

  const notificationRows = adminRecipientIds.map((userId) => ({
    user_id: userId,
    actor_name: reporterHandle,
    type: "admin_report",
    post_id: targetContext.postId,
    message,
    read: false,
  }));

  await Promise.all(
    notificationRows.map((notificationRow) => insertNotificationRecord(adminClient, notificationRow))
  );

  return notificationRows;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimit = applyRateLimit({
      key: `report-submit:${ip}`,
      windowMs: 60_000,
      max: 10,
      blockMs: 5 * 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Too many reports right now. Try again in ${rateLimit.retryAfterSeconds}s.` },
        { status: 429 }
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as ReportBody;
    const type = body.type === "comment" ? "comment" : body.type === "post" ? "post" : null;
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const rawReason = typeof body.reason === "string" ? body.reason : "";
    const reason = sanitizeUserText(rawReason, 1000);

    if (!type || !targetId) {
      return NextResponse.json({ error: "A valid report target is required." }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "Please include a reason for the report." }, { status: 400 });
    }

    if (hasSuspiciousInput(rawReason)) {
      return NextResponse.json({ error: "That report reason looks invalid." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error: reportError } = await adminClient.from("reports").insert({
      type,
      reported_id: targetId,
      reporter_id: user.id,
      reported_by: user.id,
      reason,
      created_at: new Date().toISOString(),
    });

    if (reportError) {
      throw reportError;
    }

    const notificationRows = await createAdminReportNotifications(adminClient, type, targetId, user.id);

    try {
      await sendPushNotificationsForSources(adminClient, notificationRows);
    } catch (pushError) {
      console.error("[push] Failed to send admin report push notification", pushError);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to submit report." },
      { status: 500 }
    );
  }
}