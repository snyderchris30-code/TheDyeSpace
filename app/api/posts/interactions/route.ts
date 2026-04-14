import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin, isVoided } from "@/lib/admin-utils";
import { isMissingInteractionTablesError } from "@/lib/post-interactions";
import { loadLegacyInteractions, loadRelationalInteractions } from "@/lib/post-interaction-loaders";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseValidPostIds(rawValue: string) {
  const parsed = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const validPostIds = parsed.filter((postId) => UUID_RE.test(postId));
  const invalidPostIds = parsed.filter((postId) => !UUID_RE.test(postId));

  return {
    validPostIds,
    invalidPostIds,
  };
}

export async function GET(req: NextRequest) {
  const { validPostIds, invalidPostIds } = parseValidPostIds(
    req.nextUrl.searchParams.get("postIds") || ""
  );

  if (!validPostIds.length) {
    if (invalidPostIds.length) {
      console.warn("[posts/interactions] Ignoring malformed postIds", {
        invalidCount: invalidPostIds.length,
      });
      return NextResponse.json({
        interactionsByPostId: {},
        degraded: true,
        reason: "invalid_post_ids",
      });
    }

    return NextResponse.json({ interactionsByPostId: {} });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let adminClient: ReturnType<typeof createAdminClient>;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      console.error("[posts/interactions] Missing service role configuration", { error });
      return NextResponse.json({ interactionsByPostId: {}, degraded: true });
    }

    const viewerIsAdmin = user ? await userIsAdmin(adminClient, user.id) : false;
    try {
      const interactionsByPostId = await loadRelationalInteractions(
        adminClient,
        validPostIds,
        user?.id || null,
        viewerIsAdmin
      );
      return NextResponse.json({
        interactionsByPostId,
        storage: "relational",
        degraded: invalidPostIds.length > 0,
        ignoredInvalidPostIds: invalidPostIds.length || undefined,
      });
    } catch (error: any) {
      if (!isMissingInteractionTablesError(error)) {
        console.error("[posts/interactions] Relational load failed; returning degraded payload", {
          error: error?.message || error,
        });
        return NextResponse.json({ interactionsByPostId: {}, degraded: true });
      }
    }

    const interactionsByPostId = await loadLegacyInteractions(
      adminClient,
      validPostIds,
      user?.id || null,
      viewerIsAdmin
    );
    return NextResponse.json({
      interactionsByPostId,
      storage: "legacy",
      degraded: invalidPostIds.length > 0,
      ignoredInvalidPostIds: invalidPostIds.length || undefined,
    });
  } catch (error: any) {
    console.error("[posts/interactions] Unhandled route failure; returning degraded payload", {
      error: error?.message || error,
    });
    return NextResponse.json({ interactionsByPostId: {}, degraded: true });
  }
}