import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient, userIsAdmin } from "@/lib/admin-utils";
import { type AdminActionName } from "@/lib/admin-actions";

type AdminActionBody = {
  targetUserId?: string;
  action?: AdminActionName;
  durationHours?: number;
};

const VALID_ACTIONS: AdminActionName[] = ["mute", "cosmic_timeout", "send_to_void", "shadow_ban", "clear_shadow_ban", "give_verified_badge", "remove_verified_badge", "invite_smoke_room_2", "revoke_smoke_room_2"];
const MUTE_DURATIONS = [4, 8, 12];
const SHADOW_BAN_DURATIONS = [4, 8, 12, 24];
const VOID_DURATION_HOURS = 24;
const COSMIC_TIMEOUT_DURATIONS = [4];

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
    let updates: Record<string, string | boolean | null> = {};
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
      if (!durationHours || !COSMIC_TIMEOUT_DURATIONS.includes(durationHours)) {
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

    if (action === "shadow_ban") {
      if (!durationHours || !SHADOW_BAN_DURATIONS.includes(durationHours)) {
        return NextResponse.json({ error: "Invalid shadow ban duration." }, { status: 400 });
      }

      const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();
      updates = {
        shadow_banned: true,
        shadow_banned_until: expiresAt,
      };
      message = `User shadow banned for ${durationHours} hours.`;
    }

    if (action === "clear_shadow_ban") {
      updates = {
        shadow_banned: false,
        shadow_banned_until: null,
      };
      message = "Shadow ban removed.";
    }

    if (action === "give_verified_badge") {
      updates = { verified_badge: true, smoke_room_2_invited: true };
      message = "Verified Badge granted.";
    }

    if (action === "remove_verified_badge") {
      updates = { verified_badge: false, smoke_room_2_invited: false };
      message = "Verified Badge removed.";
    }

    if (action === "invite_smoke_room_2") {
      updates = { smoke_room_2_invited: true };
      message = "User invited to The Smoke Room 2.0.";
    }

    if (action === "revoke_smoke_room_2") {
      updates = { smoke_room_2_invited: false };
      message = "User removed from The Smoke Room 2.0 invite list.";
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
