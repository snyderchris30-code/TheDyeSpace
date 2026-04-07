import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ModerationReportType = "post" | "comment";

type RawReportRecord = {
  id: string;
  reporter_id: string | null;
  reported_id: string | null;
  reason: string;
  created_at: string;
  type: ModerationReportType | string;
};

type ProfileSummary = {
  id: string;
  username: string | null;
  display_name: string | null;
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

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const adminClient = createAdminClient();
  const isAdmin = await userIsAdmin(adminClient, user.id);
  if (!isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { adminClient, user };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) {
      return auth.error;
    }

    const { adminClient } = auth;
    const { data: rawReports, error: reportsError } = await adminClient
      .from("reports")
      .select("id, reporter_id, reported_id, reason, created_at, type")
      .in("type", ["post", "comment"])
      .not("reported_id", "is", null)
      .order("created_at", { ascending: false });

    if (reportsError) {
      return NextResponse.json({ error: reportsError.message }, { status: 500 });
    }

    const reports = ((rawReports || []) as RawReportRecord[]).filter(
      (report): report is RawReportRecord & { reported_id: string; type: ModerationReportType } =>
        Boolean(report.reported_id) && (report.type === "post" || report.type === "comment")
    );

    const reporterIds = [...new Set(reports.map((report) => report.reporter_id).filter((value): value is string => Boolean(value)))];
    const commentIds = reports.filter((report) => report.type === "comment").map((report) => report.reported_id);
    const directPostIds = reports.filter((report) => report.type === "post").map((report) => report.reported_id);

    const [{ data: commentsData, error: commentsError }] = await Promise.all([
      commentIds.length
        ? adminClient
            .from("post_comments")
            .select("id, post_id, user_id, content, created_at, deleted_at")
            .in("id", commentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (commentsError) {
      return NextResponse.json({ error: commentsError.message }, { status: 500 });
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
      return NextResponse.json({ error: postsError.message }, { status: 500 });
    }

    const posts = (postsData || []) as PostSummary[];
    const authorIds = [...new Set([
      ...reporterIds,
      ...posts.map((post) => post.user_id).filter((value): value is string => Boolean(value)),
      ...comments.map((comment) => comment.user_id).filter((value): value is string => Boolean(value)),
    ])];

    const [{ data: profilesData, error: profilesError }] = await Promise.all([
      authorIds.length
        ? adminClient
            .from("profiles")
            .select("id, username, display_name")
            .in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }

    const postsById = new Map<string, PostSummary>(posts.map((post) => [post.id, post]));
    const commentsById = new Map<string, CommentSummary>(comments.map((comment) => [comment.id, comment]));
    const profilesById = new Map<string, ProfileSummary>(((profilesData || []) as ProfileSummary[]).map((profile) => [profile.id, profile]));

    const queue = reports.map((report) => {
      const reporter = report.reporter_id ? profilesById.get(report.reporter_id) : null;
      const targetPost = report.type === "post" ? postsById.get(report.reported_id) : null;
      const targetComment = report.type === "comment" ? commentsById.get(report.reported_id) : null;
      const targetAuthorId = report.type === "post" ? targetPost?.user_id ?? null : targetComment?.user_id ?? null;
      const targetAuthor = targetAuthorId ? profilesById.get(targetAuthorId) : null;
      const parentPost = report.type === "comment" && targetComment?.post_id ? postsById.get(targetComment.post_id) : null;
      const preview = report.type === "post"
        ? truncateText(targetPost?.content, 240) || "Image-only post"
        : truncateText(targetComment?.content, 200) || "Comment content unavailable";

      return {
        id: report.id,
        type: report.type,
        reason: report.reason,
        createdAt: report.created_at,
        targetId: report.reported_id,
        postId: report.type === "post" ? report.reported_id : targetComment?.post_id ?? null,
        deletedAt: report.type === "post" ? targetPost?.deleted_at ?? null : targetComment?.deleted_at ?? null,
        targetMissing: report.type === "post" ? !targetPost : !targetComment,
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

    return NextResponse.json({ reports: queue });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load moderation queue." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) {
      return auth.error;
    }

    const { adminClient } = auth;
    const body = (await req.json().catch(() => ({}))) as {
      action?: "dismiss" | "dismiss_target";
      reportId?: string;
      targetId?: string;
      reportType?: ModerationReportType;
    };

    if (body.action === "dismiss" && body.reportId) {
      const { error } = await adminClient.from("reports").delete().eq("id", body.reportId);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    if (body.action === "dismiss_target" && body.targetId && (body.reportType === "post" || body.reportType === "comment")) {
      const { error } = await adminClient
        .from("reports")
        .delete()
        .eq("reported_id", body.targetId)
        .eq("type", body.reportType);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid moderation action." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to update the moderation queue." },
      { status: 500 }
    );
  }
}