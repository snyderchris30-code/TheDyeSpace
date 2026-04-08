import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ADMIN_USER_UID } from "@/lib/admin-actions";

function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }
  return createServiceClient(serviceUrl, serviceKey, { auth: { persistSession: false } });
}

async function isUserAdmin(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  if (userId === ADMIN_USER_UID) {
    return true;
  }

  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return profile?.role === "admin";
}

// PATCH /api/posts/manage — edit post content
export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { postId?: string; content?: string };
  const content = body.content?.trim();
  if (!body.postId || !content) {
    return NextResponse.json({ error: "postId and content are required" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: post, error: fetchError } = await adminClient
    .from("posts")
    .select("id, user_id")
    .eq("id", body.postId)
    .maybeSingle();

  if (fetchError || !post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (post.user_id !== user.id) {
    const admin = await isUserAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error: updateError } = await adminClient
    .from("posts")
    .update({ content })
    .eq("id", body.postId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, content });
}

// DELETE /api/posts/manage?postId=... — soft-delete by default
export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const postId = searchParams.get("postId");
  const mode = searchParams.get("mode") || "soft";
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: post, error: fetchError } = await adminClient
    .from("posts")
    .select("id, user_id, deleted_at")
    .eq("id", postId)
    .maybeSingle();

  if (fetchError || !post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (post.user_id !== user.id) {
    const admin = await isUserAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (mode === "restore") {
    const admin = await isUserAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: restorePostError } = await adminClient
      .from("posts")
      .update({ deleted_at: null })
      .eq("id", postId);

    if (restorePostError) {
      return NextResponse.json({ error: restorePostError.message }, { status: 500 });
    }

    await adminClient
      .from("post_comments")
      .update({ deleted_at: null })
      .eq("post_id", postId);

    return NextResponse.json({ success: true, mode: "restore" });
  }

  if (mode === "permanent") {
    const admin = await isUserAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await adminClient.from("post_comments").delete().eq("post_id", postId);
    await adminClient.from("post_reactions").delete().eq("post_id", postId);

    const { error: deleteError } = await adminClient.from("posts").delete().eq("id", postId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, mode: "permanent" });
  }

  const timestamp = new Date().toISOString();
  await adminClient
    .from("post_comments")
    .update({ deleted_at: timestamp })
    .eq("post_id", postId)
    .is("deleted_at", null);

  const { error: softDeleteError } = await adminClient
    .from("posts")
    .update({ deleted_at: timestamp, comments_count: 0, likes: 0 })
    .eq("id", postId);

  if (softDeleteError) {
    return NextResponse.json({ error: softDeleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, mode: "soft" });
}
