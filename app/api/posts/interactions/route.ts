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

    const adminClient = createAdminClient();
    const viewerIsAdmin = user ? await userIsAdmin(adminClient, user.id) : false;
    try {
      const interactionsByPostId = await loadRelationalInteractions(adminClient, postIds, user?.id || null, viewerIsAdmin);
      return NextResponse.json({ interactionsByPostId, storage: "relational" });
    } catch (error: any) {
      if (!isMissingInteractionTablesError(error)) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const interactionsByPostId = await loadLegacyInteractions(adminClient, postIds, user?.id || null);
    return NextResponse.json({ interactionsByPostId, storage: "legacy" });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load interactions." },
      { status: 500 }
    );
  }
}