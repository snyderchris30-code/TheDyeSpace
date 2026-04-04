import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    const imageUrls = Array.isArray(body.image_urls)
      ? body.image_urls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [];

    if (!content) {
      return NextResponse.json({ error: "Post content is required." }, { status: 400 });
    }

    const { error: insertError } = await supabase.from("posts").insert({
      user_id: user.id,
      content,
      image_urls: imageUrls.length ? imageUrls : null,
      is_for_sale: Boolean(body.is_for_sale),
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to create post." },
      { status: 500 }
    );
  }
}
