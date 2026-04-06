import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { resolveProfileUsername } from "@/lib/profile-identity";

type InviteBody = {
  targetUserId?: string;
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

    const body = (await req.json().catch(() => ({}))) as InviteBody;
    if (!body.targetUserId) {
      return NextResponse.json({ error: "targetUserId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const admin = await userIsAdmin(adminClient, user.id);
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: actorProfile } = await adminClient
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    const actorName =
      actorProfile?.display_name?.trim() ||
      resolveProfileUsername(actorProfile?.username, user.user_metadata?.username, user.email, user.id);

    const payload = {
      user_id: body.targetUserId,
      actor_name: actorName,
      type: "smoke_session_invite",
      post_id: null,
      message: `${actorName} invited you to a smoke session in the lounge.`,
      read: false,
    };

    const { error: insertError } = await adminClient.from("notifications").insert(payload);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to send smoke session invite." },
      { status: 500 }
    );
  }
}
