import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";

export async function GET() {
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
    const { data, error } = await adminClient
      .from("profiles")
      .select("username, ghost_ridin")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      username: typeof data?.username === "string" ? data.username : null,
      ghostRidin: data?.ghost_ridin === true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load profile settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { ghostRidin?: boolean };
    if (typeof body.ghostRidin !== "boolean") {
      return NextResponse.json({ error: "ghostRidin must be a boolean." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("profiles")
      .update({ ghost_ridin: body.ghostRidin })
      .eq("id", user.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true, ghostRidin: body.ghostRidin });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to update profile settings." },
      { status: 500 }
    );
  }
}
