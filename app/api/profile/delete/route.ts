import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";

const DELETE_CONFIRMATION = "DELETE MY ACCOUNT";

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

    const body = (await req.json().catch(() => ({}))) as { confirmation?: string };
    if (body.confirmation !== DELETE_CONFIRMATION) {
      return NextResponse.json(
        { error: `Please type exactly \"${DELETE_CONFIRMATION}\" to continue.` },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      throw deleteError;
    }

    await supabase.auth.signOut({ scope: "global" });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          typeof error?.message === "string"
            ? error.message
            : "Failed to delete your account. Please contact support.",
      },
      { status: 500 }
    );
  }
}
