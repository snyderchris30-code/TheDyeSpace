import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";

type AdminActionBody = {
  targetUserId?: string;
  action?: "mute" | "cosmic_timeout" | "send_to_void" | "cosmic_blessing";
  durationHours?: number;
};

const VALID_ACTIONS = ["mute", "cosmic_timeout", "send_to_void", "cosmic_blessing"] as const;
const MUTE_DURATIONS = [4, 8, 12];
const VOID_DURATION_HOURS = 24;
const BLESS_DURATION_HOURS = 24;

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

    const body = (await req.json().catch(() => ({}))) as AdminActionBody;
    const { targetUserId, action, durationHours } = body;

    if (!targetUserId || !action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid admin action or target user." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const isAdmin = await userIsAdmin(adminClient, user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", targetUserId)
      .limit(1)
      .maybeSingle();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: "Target user not found." }, { status: 404 });
    }

    const now = new Date();
    let updates: Record<string, string | null> = {};
    let message = "";

    if (action === "mute") {
      if (!durationHours || !MUTE_DURATIONS.includes(durationHours)) {
        return NextResponse.json({ error: "Invalid mute duration." }, { status: 400 });
      }
      const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();
      updates = { muted_until: expiresAt };
      message = `User muted for ${durationHours} hours.`;
    }

    if (action === "cosmic_timeout") {
      if (!durationHours || !MUTE_DURATIONS.includes(durationHours)) {
        return NextResponse.json({ error: "Invalid cosmic timeout duration." }, { status: 400 });
      }
      const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();
      updates = { muted_until: expiresAt };
      message = `Sent to the shadow realm for ${durationHours} hours.`;
    }

    if (action === "send_to_void") {
      const expiresAt = new Date(now.getTime() + VOID_DURATION_HOURS * 60 * 60 * 1000).toISOString();
      updates = { voided_until: expiresAt };
      message = `User sent to the Void for ${VOID_DURATION_HOURS} hours.`;
    }

    if (action === "cosmic_blessing") {
      const expiresAt = new Date(now.getTime() + BLESS_DURATION_HOURS * 60 * 60 * 1000).toISOString();
      updates = { blessed_until: expiresAt };
      message = `Cosmic blessing granted for ${BLESS_DURATION_HOURS} hours.`;
    }

    const { error: updateError } = await adminClient.from("profiles").update(updates).eq("id", targetUserId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, action, message, updates });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to apply admin action." },
      { status: 500 }
    );
  }
}
