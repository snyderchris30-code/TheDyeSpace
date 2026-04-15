import { NextRequest, NextResponse } from "next/server";
import { ADMIN_USER_UID } from "@/lib/admin-actions";
import { createAdminClient } from "@/lib/admin-utils";
import { sendPushNotificationsForSources } from "@/lib/push-notifications";
import { isUuid, resolveShopListingContext } from "@/lib/shop-listings";
import { applyRateLimit, getClientIp, hasSuspiciousInput, sanitizeUserText } from "@/lib/security/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeSellerProducts } from "@/lib/verified-seller";

type ReportType = "post" | "comment" | "user";

type ReportBody = {
  type?: string;
  targetId?: string;
  reason?: string;
};

type ReportTargetContext = {
  postId: string | null;
  reportedId: string | null;
  reportedKey: string;
  targetHandle: string | null;
  targetUserId: string | null;
  contentUrl: string;
  isShopListing: boolean;
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
  const { data, error } = await adminClient
    .from("profiles")
    .select("id")
    .in("role", ["admin", "moderator", "mod"]);

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
    const shopListingContext = resolveShopListingContext(targetId);
    if (shopListingContext) {
      const { data: sellerProfile, error: sellerProfileError } = await adminClient
        .from("profiles")
        .select("id,username,display_name,theme_settings")
        .eq("id", shopListingContext.sellerUserId)
        .limit(1)
        .maybeSingle<{
          id: string;
          username: string | null;
          display_name: string | null;
          theme_settings: Record<string, unknown> | null;
        }>();

      if (sellerProfileError) {
        throw sellerProfileError;
      }

      if (!sellerProfile) {
        throw new Error("That seller listing could not be found.");
      }

      const shopProducts = normalizeSellerProducts(sellerProfile.theme_settings?.shop_products);
      const product = shopProducts.find((candidate) => candidate.id === shopListingContext.productId);
      if (!product) {
        throw new Error("That seller listing could not be found.");
      }

      const username = normalizeHandle(sellerProfile.username);

      return {
        postId: null,
        reportedId: null,
        reportedKey: targetId,
        targetHandle: username ?? normalizeHandle(sellerProfile.display_name),
        targetUserId: sellerProfile.id,
        contentUrl: username
          ? `/profile/${encodeURIComponent(username)}/shop`
          : `/profile?userId=${encodeURIComponent(sellerProfile.id)}`,
        isShopListing: true,
      };
    }

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
      return {
        postId: post.id,
        reportedId: post.id,
        reportedKey: post.id,
        targetHandle: null,
        targetUserId: null,
        contentUrl: `/explore?postId=${encodeURIComponent(post.id)}`,
        isShopListing: false,
      };
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
      reportedId: post.id,
      reportedKey: post.id,
      targetHandle: normalizeHandle(author?.username) ?? normalizeHandle(author?.display_name),
      targetUserId: post.user_id,
      contentUrl: `/explore?postId=${encodeURIComponent(post.id)}`,
      isShopListing: false,
    };
  }

  if (type === "user") {
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id,username,display_name")
      .eq("id", targetId)
      .limit(1)
      .maybeSingle<{ id: string; username: string | null; display_name: string | null }>();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      throw new Error("That profile could not be found.");
    }

    const username = normalizeHandle(profile.username);

    return {
      postId: null,
      reportedId: profile.id,
      reportedKey: profile.id,
      targetHandle: username ?? normalizeHandle(profile.display_name),
      targetUserId: profile.id,
      contentUrl: username
        ? `/profile/${encodeURIComponent(username)}`
        : `/explore?profileId=${encodeURIComponent(profile.id)}`,
      isShopListing: false,
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
    const params = new URLSearchParams();
    if (comment.post_id) {
      params.set("postId", comment.post_id);
    }
    params.set("commentId", comment.id);

    return {
      postId: comment.post_id ?? null,
      reportedId: comment.id,
      reportedKey: comment.id,
      targetHandle: null,
      targetUserId: null,
      contentUrl: `/explore?${params.toString()}`,
      isShopListing: false,
    };
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

  const params = new URLSearchParams();
  if (comment.post_id) {
    params.set("postId", comment.post_id);
  }
  params.set("commentId", comment.id);

  return {
    postId: comment.post_id ?? null,
    reportedId: comment.id,
    reportedKey: comment.id,
    targetHandle: normalizeHandle(author?.username) ?? normalizeHandle(author?.display_name),
    targetUserId: comment.user_id,
    contentUrl: `/explore?${params.toString()}`,
    isShopListing: false,
  };
}

async function createAdminReportNotifications(
  adminClient: ReturnType<typeof createAdminClient>,
  reportType: ReportType,
  reporterId: string,
  targetContext: ReportTargetContext
) {
  const [{ data: reporter, error: reporterError }, adminRecipientIds] = await Promise.all([
    adminClient
      .from("profiles")
      .select("username,display_name")
      .eq("id", reporterId)
      .limit(1)
      .maybeSingle<{ username: string | null; display_name: string | null }>(),
    getAdminRecipientIds(adminClient),
  ]);

  if (reporterError) {
    throw reporterError;
  }

  const reporterHandle = normalizeHandle(reporter?.username) ?? normalizeHandle(reporter?.display_name) ?? "Report Alert";
  const targetLabel = targetContext.targetHandle ? ` by @${targetContext.targetHandle}` : "";
  const message =
    reportType === "post"
      ? targetContext.isShopListing
        ? `New report on For Sale item${targetLabel}. Open the Moderation Queue.`
        : `New report on post${targetLabel}. Open the Moderation Queue.`
      : reportType === "comment"
        ? `New report on comment${targetLabel}. Open the Moderation Queue.`
        : `New report on profile${targetLabel}. Open the Moderation Queue.`;

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

  return { notificationRows, reporterHandle };
}

function normalizeReportWatcherEntityType(type: ReportType): "post" | "comment" | "profile" {
  if (type === "user") {
    return "profile";
  }

  return type;
}

async function upsertReportWatcherSignal(
  adminClient: ReturnType<typeof createAdminClient>,
  params: {
    reportId: string;
    reportType: ReportType;
    targetId: string;
    reporterId: string;
    reporterHandle: string;
    reason: string;
    targetContext: ReportTargetContext;
  }
) {
  const now = new Date().toISOString();
  const entityType = normalizeReportWatcherEntityType(params.reportType);

  const { error } = await adminClient
    .from("moderation_flags")
    .upsert(
      {
        entity_type: entityType,
        entity_id: params.targetId,
        related_post_id: params.targetContext.postId,
        related_comment_id: params.reportType === "comment" ? params.targetContext.reportedId : null,
        related_profile_id: params.targetContext.targetUserId,
        actor_user_id: params.reporterId,
        content_url: params.targetContext.contentUrl,
        excerpt: `User report submitted: ${params.reason}`,
        reason: `User report: ${params.reason}`,
        categories: ["community_suspicious"],
        confidence_score: 0.995,
        source_created_at: now,
        metadata: {
          source: "user_report",
          reportId: params.reportId,
          reportType: params.reportType,
          reporter: {
            id: params.reporterId,
            handle: params.reporterHandle,
          },
          target: {
            id: params.targetId,
            handle: params.targetContext.targetHandle,
            userId: params.targetContext.targetUserId,
            postId: params.targetContext.postId,
          },
        },
        status: "open",
        last_seen_at: now,
        reviewed_at: null,
        reviewed_by: null,
      },
      { onConflict: "entity_type,entity_id" }
    );

  if (error) {
    throw error;
  }
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
    const type =
      body.type === "comment"
        ? "comment"
        : body.type === "post"
          ? "post"
          : body.type === "user"
            ? "user"
            : null;
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
    const targetContext = await resolveReportTargetContext(adminClient, type, targetId);

    const { data: reportRow, error: reportError } = await adminClient
      .from("reports")
      .insert({
        type,
        reported_id: targetContext.reportedId,
        reported_key: targetContext.reportedKey,
        reported_user_id: targetContext.targetUserId,
        reporter_id: user.id,
        reported_by: user.id,
        reason,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();

    if (reportError) {
      throw reportError;
    }

    const { notificationRows, reporterHandle } = await createAdminReportNotifications(
      adminClient,
      type,
      user.id,
      targetContext
    );

    await upsertReportWatcherSignal(adminClient, {
      reportId: reportRow.id,
      reportType: type,
      targetId: targetContext.reportedKey,
      reporterId: user.id,
      reporterHandle,
      reason,
      targetContext,
    });

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