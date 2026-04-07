import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, loadProfileStatus, isMuted } from "@/lib/admin-utils";
import { normalizePostImageUrls } from "@/lib/post-media";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";

type CreatePostBody = {
  content?: string;
  image_urls?: string[] | null;
  is_for_sale?: boolean;
};

export async function POST(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "posts/create");
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("posts/create", "Unauthorized post creation attempt", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as CreatePostBody;
    const content = body.content?.trim();
    const imageUrls = normalizePostImageUrls(body.image_urls);

    if (!content) {
      logWarn("posts/create", "Rejected post creation with empty content", {
        ...requestContext,
        userId: user.id,
        imageCount: imageUrls.length,
      });
      return NextResponse.json({ error: "Post content is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const currentUserStatus = await loadProfileStatus(adminClient, user.id);
    if (isMuted(currentUserStatus)) {
      logWarn("posts/create", "Rejected post creation for muted user", {
        ...requestContext,
        userId: user.id,
        mutedUntil: currentUserStatus?.muted_until ?? null,
      });
      return NextResponse.json({ error: "You are muted and cannot create posts at this time." }, { status: 403 });
    }

    logInfo("posts/create", "Attempting post insert", {
      ...requestContext,
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
      logError("posts/create", "Failed post insert", insertError, {
        ...requestContext,
        userId: user.id,
        imageCount: imageUrls.length,
      });
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    logInfo("posts/create", "Post insert succeeded", {
      ...requestContext,
      userId: user.id,
      imageCount: imageUrls.length,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    logError("posts/create", "Unexpected failure", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to create post." },
      { status: 500 }
    );
  }
}
