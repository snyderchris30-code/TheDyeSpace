import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin, isVoided } from "@/lib/admin-utils";
import { isMissingInteractionTablesError } from "@/lib/post-interactions";
import { loadLegacyInteractions, loadRelationalInteractions } from "@/lib/post-interaction-loaders";
import { resolveShopListingContext } from "@/lib/shop-listings";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseValidPostIds(rawValue: string) {
  const parsed = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const relationalPostIds = parsed.filter((postId) => UUID_RE.test(postId));
  const shopListingPostIds = parsed.filter((postId) => !UUID_RE.test(postId) && Boolean(resolveShopListingContext(postId)));
  const invalidPostIds = parsed.filter((postId) => !UUID_RE.test(postId) && !resolveShopListingContext(postId));

  return {
    relationalPostIds,
    shopListingPostIds,
    invalidPostIds,
  };
}

export async function GET(req: NextRequest) {
  const { relationalPostIds, shopListingPostIds, invalidPostIds } = parseValidPostIds(
    req.nextUrl.searchParams.get("postIds") || ""
  );

  if (!relationalPostIds.length && !shopListingPostIds.length) {
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
      const interactionsByPostId = {
        ...(relationalPostIds.length
          ? await loadRelationalInteractions(adminClient, relationalPostIds, user?.id || null, viewerIsAdmin)
          : {}),
        ...(shopListingPostIds.length
          ? await loadLegacyInteractions(adminClient, shopListingPostIds, user?.id || null, viewerIsAdmin)
          : {}),
      };
      return NextResponse.json({
        interactionsByPostId,
        storage: relationalPostIds.length ? "relational" : "legacy",
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

    const allSupportedPostIds = [...relationalPostIds, ...shopListingPostIds];
    const interactionsByPostId = await loadLegacyInteractions(adminClient, allSupportedPostIds, user?.id || null, viewerIsAdmin);
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