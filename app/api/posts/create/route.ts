import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, loadProfileStatus, isMuted } from "@/lib/admin-utils";
import { normalizePostImageUrls } from "@/lib/post-media";

type CreatePostBody = {
  content?: string;
  image_urls?: string[] | null;
  is_for_sale?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as CreatePostBody;
    const content = body.content?.trim();
    const imageUrls = normalizePostImageUrls(body.image_urls);

    if (!content) {
      return NextResponse.json({ error: "Post content is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      return NextResponse.json({ error: "You are muted and cannot create posts at this time." }, { status: 403 });
    }

    console.info("[posts/create] Attempting post insert", {
      userId: user.id,
      contentLength: content.length,
      imageCount: imageUrls.length,
      hasForSaleFlag: Boolean(body.is_for_sale),
    });

    const { error: insertError } = await adminClient.from("posts").insert({
      user_id: user.id,
      content,
      image_urls: imageUrls.length ? imageUrls : null,
      is_for_sale: Boolean(body.is_for_sale),
    });

    if (insertError) {
      console.error("[posts/create] Failed post insert", {
        userId: user.id,
        imageCount: imageUrls.length,
        error: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        code: insertError.code,
      });
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    console.info("[posts/create] Post insert succeeded", {
      userId: user.id,
      imageCount: imageUrls.length,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[posts/create] Unexpected failure", {
      error: error?.message || error,
    });
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to create post." },
      { status: 500 }
    );
  }
}
