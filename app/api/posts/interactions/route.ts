import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin, isVoided } from "@/lib/admin-utils";
import {
  buildInteractionsFromRows,
  isMissingInteractionTablesError,
  type InteractionProfileRow,
  type RelationalPostCommentRow,
  type RelationalPostReactionRow,
} from "@/lib/post-interactions";

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

async function loadRelationalInteractions(adminClient: ReturnType<typeof createAdminClient>, postIds: string[], viewerId?: string | null, viewerIsAdmin = false) {
  const { data: comments, error: commentsError } = await adminClient
    .from("post_comments")
    .select("id, post_id, user_id, content, created_at")
    .in("post_id", postIds)
    .is("deleted_at", null)
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
  let profiles: Array<InteractionProfileRow & { voided_until?: string | null }> = [];

  if (userIds.length) {
    const { data: profileRows, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, username, display_name, avatar_url, theme_settings, voided_until")
      .in("id", userIds);

    if (profilesError) {
      throw profilesError;
    }

    profiles = (profileRows || []) as InteractionProfileRow[];
  }

  const visibleComments = comments || [];
  if (!viewerIsAdmin) {
    const voidedAuthors = new Set(profiles.filter((profile) => isVoided(profile)).map((profile) => profile.id));
    return buildInteractionsFromRows(
      postIds,
      visibleComments.filter((comment) => !voidedAuthors.has(comment.user_id)) as RelationalPostCommentRow[],
      (reactions || []) as RelationalPostReactionRow[],
      profiles,
      viewerId
    );
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