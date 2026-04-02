import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

type UpdateStatusBody = {
  postId: string;
  status: "sold" | "unavailable";
};

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: service role key missing" },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as UpdateStatusBody;

  if (!body.postId || !body.status) {
    return NextResponse.json({ error: "Missing postId or status" }, { status: 400 });
  }

  const adminClient = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Fetch the post first to verify ownership and get current content
  const { data: post, error: fetchError } = await adminClient
    .from("posts")
    .select("id, user_id, content")
    .eq("id", body.postId)
    .maybeSingle();

  if (fetchError || !post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Strip any existing category tag and prepend the new status tag
  const cleanedContent = (post.content || "")
    .replace(/^\[(tutorial|new_boot_goofin|sold|unavailable)\]\s*/i, "")
    .trim();
  const statusTag = body.status === "sold" ? "[sold]" : "[unavailable]";
  const newContent = `${statusTag} ${cleanedContent}`.trim();

  const { error: updateError } = await adminClient
    .from("posts")
    .update({ is_for_sale: false, content: newContent })
    .eq("id", body.postId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, content: newContent });
}
