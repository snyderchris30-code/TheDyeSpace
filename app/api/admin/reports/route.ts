import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { isShopListingId, isUuid, resolveShopListingContext } from "@/lib/shop-listings";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeSellerProducts } from "@/lib/verified-seller";

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

type ModerationReportType = "post" | "comment" | "user";

type RawReportRecord = {
  id: string;
  reporter_id: string | null;
  reported_id: string | null;
  reported_key: string | null;
  reported_user_id: string | null;
  reason: string;
  created_at: string;
  type: ModerationReportType | string;
};

type ProfileSummary = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio?: string | null;
  theme_settings?: Record<string, unknown> | null;
};

type PostSummary = {
  id: string;
  user_id: string | null;
  content: string | null;
  created_at: string | null;
  deleted_at?: string | null;
};

type CommentSummary = {
  id: string;
  post_id: string | null;
  user_id: string | null;
  content: string | null;
  created_at: string | null;
  deleted_at?: string | null;
};

function truncateText(value: string | null | undefined, maxLength = 240) {
  const text = (value || "").trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

function jsonError(message: string, status: number, code: ApiErrorCode) {
  return NextResponse.json(
    {
      error: message,
      code,
    },
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

async function requireAdmin(req: NextRequest, requestContext: Record<string, unknown>) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("admin/reports", "Unauthorized admin reports request", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return { error: jsonError("Unauthorized", 401, "UNAUTHORIZED") };
    }

    const adminClient = createAdminClient();
    const isAdmin = await userIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      logWarn("admin/reports", "Forbidden admin reports request", {
        ...requestContext,
        userId: user.id,
      });
      return { error: jsonError("Forbidden", 403, "FORBIDDEN") };
    }

    return { adminClient, user };
  } catch (error: any) {
    logError("admin/reports", "Failed to validate admin access", error, requestContext);
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
  const requestContext = createRequestLogContext(req, "admin/reports");
  try {
    const auth = await requireAdmin(req, requestContext);
    if (auth.error) {
      return auth.error;
    }

    const { adminClient, user } = auth;
    logInfo("admin/reports", "Loading moderation queue", {
      ...requestContext,
      adminUserId: user.id,
    });

    const { data: rawReports, error: reportsError } = await adminClient
      .from("reports")
      .select("id, reporter_id, reported_id, reported_key, reported_user_id, reason, created_at, type")
      .order("created_at", { ascending: false });

    if (reportsError) {
      logError("admin/reports", "Failed to query reports table", reportsError, {
        ...requestContext,
        adminUserId: user.id,
      });
      return jsonError(reportsError.message, 500, "INTERNAL_ERROR");
    }

    const reports = ((rawReports || []) as RawReportRecord[])
      .map((report) => {
        const normalizedType: ModerationReportType | null =
          report.type === "post" || report.type === "comment" || report.type === "user"
            ? report.type
            : report.reported_user_id
              ? "user"
              : null;

        const normalizedTargetId = normalizedType === "user"
          ? report.reported_user_id
          : report.reported_key ?? report.reported_id;

        if (!normalizedType || !normalizedTargetId) {
          return null;
        }

        return {
          ...report,
          type: normalizedType,
          reported_key: normalizedTargetId,
        };
      })
      .filter((report): report is RawReportRecord & { reported_key: string; type: ModerationReportType } => Boolean(report));

    const reporterIds = [...new Set(reports.map((report) => report.reporter_id).filter((value): value is string => Boolean(value)))];
    const commentIds = reports
      .filter((report) => report.type === "comment" && isUuid(report.reported_key))
      .map((report) => report.reported_key);
    const directPostIds = reports
      .filter((report) => report.type === "post" && isUuid(report.reported_key))
      .map((report) => report.reported_key);
    const reportedUserIds = reports.filter((report) => report.type === "user").map((report) => report.reported_key);
    const shopListingSellerIds = reports
      .filter((report) => report.type === "post")
      .map((report) => resolveShopListingContext(report.reported_key))
      .filter((context): context is { sellerUserId: string; productId: string } => Boolean(context))
      .map((context) => context.sellerUserId);

    const [{ data: commentsData, error: commentsError }] = await Promise.all([
      commentIds.length
        ? adminClient
            .from("post_comments")
            .select("id, post_id, user_id, content, created_at, deleted_at")
            .in("id", commentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (commentsError) {
      logError("admin/reports", "Failed to load reported comments", commentsError, {
        ...requestContext,
        adminUserId: user.id,
        commentCount: commentIds.length,
      });
      return jsonError(commentsError.message, 500, "INTERNAL_ERROR");
    }

    const comments = (commentsData || []) as CommentSummary[];
    const relatedPostIds = [...new Set([...directPostIds, ...comments.map((comment) => comment.post_id).filter((value): value is string => Boolean(value))])];

    const [{ data: postsData, error: postsError }] = await Promise.all([
      relatedPostIds.length
        ? adminClient
            .from("posts")
            .select("id, user_id, content, created_at, deleted_at")
            .in("id", relatedPostIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (postsError) {
      logError("admin/reports", "Failed to load related posts", postsError, {
        ...requestContext,
        adminUserId: user.id,
        postCount: relatedPostIds.length,
      });
      return jsonError(postsError.message, 500, "INTERNAL_ERROR");
    }

    const posts = (postsData || []) as PostSummary[];
    const authorIds = [...new Set([
      ...reporterIds,
      ...reportedUserIds,
      ...shopListingSellerIds,
      ...posts.map((post) => post.user_id).filter((value): value is string => Boolean(value)),
      ...comments.map((comment) => comment.user_id).filter((value): value is string => Boolean(value)),
    ])];

    const [{ data: profilesData, error: profilesError }] = await Promise.all([
      authorIds.length
        ? adminClient
            .from("profiles")
            .select("id, username, display_name, bio, theme_settings")
            .in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) {
      logError("admin/reports", "Failed to load report-related profiles", profilesError, {
        ...requestContext,
        adminUserId: user.id,
        profileCount: authorIds.length,
      });
      return jsonError(profilesError.message, 500, "INTERNAL_ERROR");
    }

    const postsById = new Map<string, PostSummary>(posts.map((post) => [post.id, post]));
    const commentsById = new Map<string, CommentSummary>(comments.map((comment) => [comment.id, comment]));
    const profilesById = new Map<string, ProfileSummary>(((profilesData || []) as ProfileSummary[]).map((profile) => [profile.id, profile]));

    const queue = reports.map((report) => {
      const shopListingContext = report.type === "post" ? resolveShopListingContext(report.reported_key) : null;
      const reporter = report.reporter_id ? profilesById.get(report.reporter_id) : null;
      const targetPost = report.type === "post" && !shopListingContext && isUuid(report.reported_key) ? postsById.get(report.reported_key) : null;
      const targetComment = report.type === "comment" ? commentsById.get(report.reported_key) : null;
      const targetUserProfile = report.type === "user" ? profilesById.get(report.reported_key) : null;
      const shopListingProfile = shopListingContext ? profilesById.get(shopListingContext.sellerUserId) : null;
      const shopListing = shopListingContext
        ? normalizeSellerProducts(shopListingProfile?.theme_settings?.shop_products).find((product) => product.id === shopListingContext.productId) ?? null
        : null;
      const targetAuthorId = report.type === "post"
        ? shopListingContext
          ? shopListingProfile?.id ?? shopListingContext.sellerUserId
          : targetPost?.user_id ?? null
        : report.type === "comment"
          ? targetComment?.user_id ?? null
          : report.reported_key;
      const targetAuthor = targetAuthorId ? profilesById.get(targetAuthorId) : null;
      const parentPost = report.type === "comment" && targetComment?.post_id ? postsById.get(targetComment.post_id) : null;
      const preview = report.type === "post"
        ? shopListingContext
          ? truncateText(
              [shopListing?.title?.trim(), shopListing?.price ? `$${shopListing.price}` : null, shopListing?.description?.trim()]
                .filter(Boolean)
                .join(" • "),
              240
            ) || shopListing?.title || "Verified Seller Listing"
          : truncateText(targetPost?.content, 240) || "Image-only post"
        : report.type === "comment"
          ? truncateText(targetComment?.content, 200) || "Comment content unavailable"
          : truncateText(targetUserProfile?.bio, 200) || `Profile report for ${targetUserProfile?.display_name ?? targetUserProfile?.username ?? "Unknown user"}`;

      return {
        id: report.id,
        type: report.type,
        reason: report.reason,
        createdAt: report.created_at,
        targetId: report.reported_key,
        postId: report.type === "post" ? (shopListingContext ? null : report.reported_key) : report.type === "comment" ? targetComment?.post_id ?? null : null,
        deletedAt: report.type === "post" ? targetPost?.deleted_at ?? null : report.type === "comment" ? targetComment?.deleted_at ?? null : null,
        targetMissing: report.type === "post" ? (shopListingContext ? !shopListing : !targetPost) : report.type === "comment" ? !targetComment : !targetUserProfile,
        isShopListing: Boolean(shopListingContext),
        preview,
        parentPostPreview: report.type === "comment" ? truncateText(parentPost?.content, 160) || "Original post unavailable" : null,
        reporter: {
          id: report.reporter_id,
          username: reporter?.username ?? null,
          displayName: reporter?.display_name ?? reporter?.username ?? "Unknown reporter",
        },
        targetAuthor: {
          id: targetAuthorId,
          username: targetAuthor?.username ?? null,
          displayName: targetAuthor?.display_name ?? targetAuthor?.username ?? "Unknown author",
        },
      };
    });

    logInfo("admin/reports", "Loaded moderation queue", {
      ...requestContext,
      adminUserId: user.id,
      reportCount: queue.length,
      commentCount: comments.length,
      postCount: posts.length,
      profileCount: (profilesData || []).length,
    });
    return jsonOk({ reports: queue });
  } catch (error: any) {
    logError("admin/reports", "Failed to load moderation queue", error, requestContext);
    return jsonError(
      typeof error?.message === "string" ? error.message : "Failed to load moderation queue.",
      500,
      "INTERNAL_ERROR"
    );
  }
}
export async function PATCH(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "admin/reports");
  try {
    const auth = await requireAdmin(req, requestContext);
    if (auth.error) {
      return auth.error;
    }

    const { adminClient, user } = auth;
    const body = (await req.json().catch(() => ({}))) as {
      action?: "dismiss" | "dismiss_target";
      reportId?: string;
      targetId?: string;
      reportType?: ModerationReportType;
    };

    if (body.action === "dismiss" && body.reportId) {
      const { error } = await adminClient.from("reports").delete().eq("id", body.reportId);
      if (error) {
        logError("admin/reports", "Failed to dismiss report", error, {
          ...requestContext,
          adminUserId: user.id,
          reportId: body.reportId,
        });
        return jsonError(error.message, 500, "INTERNAL_ERROR");
      }

      logInfo("admin/reports", "Dismissed report", {
        ...requestContext,
        adminUserId: user.id,
        reportId: body.reportId,
      });
      return jsonOk({ success: true });
    }

    if (body.action === "dismiss_target" && body.targetId && (body.reportType === "post" || body.reportType === "comment")) {
      const { error } = await adminClient
        .from("reports")
        .delete()
        .eq("reported_key", body.targetId)
        .eq("type", body.reportType);

      if (error) {
        logError("admin/reports", "Failed to dismiss all reports for target", error, {
          ...requestContext,
          adminUserId: user.id,
          targetId: body.targetId,
          reportType: body.reportType,
        });
        return jsonError(error.message, 500, "INTERNAL_ERROR");
      }

      logInfo("admin/reports", "Dismissed reports for target", {
        ...requestContext,
        adminUserId: user.id,
        targetId: body.targetId,
        reportType: body.reportType,
      });
      return jsonOk({ success: true });
    }

    if (body.action === "dismiss_target" && body.targetId && body.reportType === "user") {
      const { error } = await adminClient
        .from("reports")
        .delete()
        .or(`and(type.eq.user,reported_key.eq.${body.targetId}),reported_user_id.eq.${body.targetId}`);

      if (error) {
        logError("admin/reports", "Failed to dismiss all user reports for target", error, {
          ...requestContext,
          adminUserId: user.id,
          targetId: body.targetId,
          reportType: body.reportType,
        });
        return jsonError(error.message, 500, "INTERNAL_ERROR");
      }

      logInfo("admin/reports", "Dismissed user reports for target", {
        ...requestContext,
        adminUserId: user.id,
        targetId: body.targetId,
        reportType: body.reportType,
      });
      return jsonOk({ success: true });
    }

    logWarn("admin/reports", "Invalid moderation action payload", {
      ...requestContext,
      adminUserId: user.id,
      action: body.action ?? null,
      reportId: body.reportId ?? null,
      targetId: body.targetId ?? null,
      reportType: body.reportType ?? null,
    });
    return jsonError("Invalid moderation action.", 400, "BAD_REQUEST");
  } catch (error: any) {
    logError("admin/reports", "Failed to update moderation queue", error, requestContext);
    return jsonError(
      typeof error?.message === "string" ? error.message : "Failed to update the moderation queue.",
      500,
      "INTERNAL_ERROR"
    );
  }
}
