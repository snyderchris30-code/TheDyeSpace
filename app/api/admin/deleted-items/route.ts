import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";

type ItemType = "post" | "comment";

type MutateBody = {
  itemType?: ItemType;
  id?: string;
  action?: "restore" | "permanent_delete";
};

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const adminClient = createAdminClient();
  const isAdmin = await userIsAdmin(adminClient, user.id);
  if (!isAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  return { adminClient, user } as const;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { adminClient } = auth;

    const { data: posts, error: postsError } = await adminClient
      .from("posts")
      .select("id, user_id, content, created_at, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(200);

    if (postsError) {
      return NextResponse.json({ error: postsError.message }, { status: 500 });
    }

    const { data: comments, error: commentsError } = await adminClient
      .from("post_comments")
      .select("id, post_id, user_id, content, created_at, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(400);

    if (commentsError) {
      return NextResponse.json({ error: commentsError.message }, { status: 500 });
    }

    return NextResponse.json({ posts: posts || [], comments: comments || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load deleted items." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { adminClient } = auth;
    const body = (await req.json().catch(() => ({}))) as MutateBody;

    if (!body.itemType || !body.id || body.action !== "restore") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (body.itemType === "post") {
      const { error: restoreError } = await adminClient
        .from("posts")
        .update({ deleted_at: null })
        .eq("id", body.id);

      if (restoreError) {
        return NextResponse.json({ error: restoreError.message }, { status: 500 });
      }

      await adminClient
        .from("post_comments")
        .update({ deleted_at: null })
        .eq("post_id", body.id);

      return NextResponse.json({ success: true });
    }

    const { error: restoreError } = await adminClient
      .from("post_comments")
      .update({ deleted_at: null })
      .eq("id", body.id);

    if (restoreError) {
      return NextResponse.json({ error: restoreError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to restore deleted item." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const { adminClient } = auth;
    const body = (await req.json().catch(() => ({}))) as MutateBody;

    if (!body.itemType || !body.id || body.action !== "permanent_delete") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (body.itemType === "post") {
      await adminClient.from("post_comments").delete().eq("post_id", body.id);
      await adminClient.from("post_reactions").delete().eq("post_id", body.id);
      const { error: deleteError } = await adminClient.from("posts").delete().eq("id", body.id);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    const { error: deleteError } = await adminClient.from("post_comments").delete().eq("id", body.id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to permanently delete item." },
      { status: 500 }
    );
  }
}
