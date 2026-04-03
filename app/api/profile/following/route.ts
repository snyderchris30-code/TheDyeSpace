import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ followingIds: [] });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("user_follows")
      .select("followed_id")
      .eq("follower_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const followingIds = (data || []).map((row: { followed_id: string }) => row.followed_id);
    return NextResponse.json({ followingIds });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load following list." }, { status: 500 });
  }
}
