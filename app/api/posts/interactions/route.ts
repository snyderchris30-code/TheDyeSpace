import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildInteractionsFromRows,
  isMissingInteractionTablesError,
  type InteractionProfileRow,
  type RelationalPostCommentRow,
  type RelationalPostReactionRow,
} from "@/lib/post-interactions";

function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

async function loadLegacyInteractions(adminClient: ReturnType<typeof createAdminClient>, postIds: string[], viewerId?: string | null) {
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, avatar_url, theme_settings");

  if (error) {
    throw error;
  }

  // buildInteractionsByPost removed; use buildInteractionsFromRows instead
  return buildInteractionsFromRows(
    postIds,
    [], // no comments available in legacy
    [], // no reactions available in legacy
    (profiles || []) as InteractionProfileRow[],
    viewerId
  );
}

async function loadRelationalInteractions(adminClient: ReturnType<typeof createAdminClient>, postIds: string[], viewerId?: string | null) {
  const { data: comments, error: commentsError } = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  if (commentsError) {
    throw commentsError;
  }

  const { data: reactions, error: reactionsError } = await adminClient
    .from("post_reactions")
    .select("post_id, user_id, emoji, created_at")
    .in("post_id", postIds);

  if (reactionsError) {
    throw reactionsError;
  }

  const userIds = [...new Set([...(comments || []).map((comment) => comment.user_id), ...(reactions || []).map((reaction) => reaction.user_id)])];
  let profiles: InteractionProfileRow[] = [];

  if (userIds.length) {
    const { data: profileRows, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url, theme_settings")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    profiles = (profileRows || []) as InteractionProfileRow[];
  }

  return buildInteractionsFromRows(
    postIds,
    (comments || []) as RelationalPostCommentRow[],
    (reactions || []) as RelationalPostReactionRow[],
    profiles,
    viewerId
  );
}

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
    try {
      const interactionsByPostId = await loadRelationalInteractions(adminClient, postIds, user?.id || null);
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