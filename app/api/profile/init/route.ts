import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
} from "@/lib/profile-theme";

export async function POST() {
  // Verify the caller is authenticated via the server client (reads the session cookie)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use the service-role client so RLS does not block the insert
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: service role key missing" },
      { status: 500 }
    );
  }

  const adminClient = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const username =
    user.user_metadata?.username || user.email || "";

  const { data: profile, error: upsertError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        username,
        display_name: "",
        bio: "",
        avatar_url: null,
        banner_url: null,
        theme_settings: {
          background_color: DEFAULT_BACKGROUND_COLOR,
          text_color: DEFAULT_TEXT_COLOR,
          highlight_color: DEFAULT_HIGHLIGHT_COLOR,
          font_style: DEFAULT_FONT_STYLE,
        },
      },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at")
    .limit(1)
    .maybeSingle();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
