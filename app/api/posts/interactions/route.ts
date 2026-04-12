import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin, isVoided } from "@/lib/admin-utils";
import { isMissingInteractionTablesError } from "@/lib/post-interactions";
import { loadLegacyInteractions, loadRelationalInteractions } from "@/lib/post-interaction-loaders";

export async function GET(req: NextRequest) {
  const postIds = (req.nextUrl.searchParams.get("postIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!postIds.length) {
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
      const interactionsByPostId = await loadRelationalInteractions(adminClient, postIds, user?.id || null, viewerIsAdmin);
      return NextResponse.json({ interactionsByPostId, storage: "relational" });
    } catch (error: any) {
      if (!isMissingInteractionTablesError(error)) {
        console.error("[posts/interactions] Relational load failed; returning degraded payload", {
          error: error?.message || error,
        });
        return NextResponse.json({ interactionsByPostId: {}, degraded: true });
      }
    }

    const interactionsByPostId = await loadLegacyInteractions(adminClient, postIds, user?.id || null);
    return NextResponse.json({ interactionsByPostId, storage: "legacy" });
  } catch (error: any) {
    console.error("[posts/interactions] Unhandled route failure; returning degraded payload", {
      error: error?.message || error,
    });
    return NextResponse.json({ interactionsByPostId: {}, degraded: true });
  }
}