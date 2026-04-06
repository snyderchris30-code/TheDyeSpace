import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { normalizeCustomEmojiUrls } from "@/lib/custom-emojis";

type UpdateCustomEmojisBody = {
  emojiUrls?: unknown;
};

async function loadCustomEmojiUrls() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("profiles")
    .select("theme_settings")
    .eq("role", "admin")
    .limit(50);

  if (error) {
    throw error;
  }

  const allUrls = (data || []).flatMap((row: any) => normalizeCustomEmojiUrls(row?.theme_settings?.custom_emojis || []));
  const unique = normalizeCustomEmojiUrls(allUrls, 300);
  return unique;
}

export async function GET() {
  try {
    const emojiUrls = await loadCustomEmojiUrls();
    return NextResponse.json({ emojiUrls });
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

    const body = (await req.json().catch(() => ({}))) as UpdateCustomEmojisBody;
    const emojiUrls = normalizeCustomEmojiUrls(body.emojiUrls || [], 300);

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("theme_settings")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const currentThemeSettings = (profile?.theme_settings && typeof profile.theme_settings === "object")
      ? profile.theme_settings
      : {};

    const nextThemeSettings = {
      ...currentThemeSettings,
      custom_emojis: emojiUrls,
    };

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ theme_settings: nextThemeSettings })
      .eq("id", user.id);

    if (updateError) {
      throw updateError;
    }

    console.info("[admin/custom-emojis] Updated custom emojis", {
      adminUserId: user.id,
      count: emojiUrls.length,
    });

    return NextResponse.json({ success: true, emojiUrls });
  } catch (error: any) {
    console.error("[admin/custom-emojis] Failed to update custom emojis", {
      error: error?.message || error,
    });
    return NextResponse.json({ error: "Failed to update custom emojis." }, { status: 500 });
  }
}
