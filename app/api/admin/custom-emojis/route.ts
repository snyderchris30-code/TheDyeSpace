import { NextRequest, NextResponse } from "next/server";

import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { listCustomEmojiAssets } from "@/lib/custom-emoji-registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const emojis = await listCustomEmojiAssets();
    return NextResponse.json({ emojis, emojiUrls: emojis.map((emoji) => emoji.url) });
  } catch (error: any) {
    console.error("[admin/custom-emojis] Failed to load custom emojis", {
      error: error?.message || error,
    });
    return NextResponse.json({ error: "Failed to load custom emojis." }, { status: 500 });
  }
}

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

    const adminClient = createAdminClient();
    const isAdmin = await userIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await req.text().catch(() => "");
    const emojis = await listCustomEmojiAssets();
    return NextResponse.json({
      success: true,
      emojiUrls: emojis.map((emoji) => emoji.url),
      message: "Custom emojis are loaded automatically from public/emojis.",
    });
  } catch (error: any) {
    console.error("[admin/custom-emojis] Failed to update custom emojis", {
      error: error?.message || error,
    });
    return NextResponse.json({ error: "Failed to update custom emojis." }, { status: 500 });
  }
}
