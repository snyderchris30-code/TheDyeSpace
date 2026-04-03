import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isMissingUserFollowsTable(error: any) {
  return error?.code === "42P01" || /user_follows/i.test(String(error?.message || ""));
}

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

export async function GET(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const targetUserId = req.nextUrl.searchParams.get("targetUserId");
    if (!targetUserId) {
      return NextResponse.json({ error: "Missing targetUserId" }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("user_follows")
      .select("follower_id")
      .eq("follower_id", user.id)
      .eq("followed_id", targetUserId)
      .maybeSingle();

    if (error) {
      if (isMissingUserFollowsTable(error)) {
        return NextResponse.json({ isFollowing: false, followFeatureReady: false });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ isFollowing: Boolean(data), followFeatureReady: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load follow state." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : null;
    const action = body?.action === "unfollow" ? "unfollow" : "follow";

    if (!targetUserId) {
      return NextResponse.json({ error: "Missing targetUserId" }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.id === targetUserId) {
      return NextResponse.json({ error: "You cannot follow yourself." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    if (action === "unfollow") {
      const { error } = await adminClient
        .from("user_follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("followed_id", targetUserId);

      if (error) {
        if (isMissingUserFollowsTable(error)) {
          return NextResponse.json({ isFollowing: false, followFeatureReady: false });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ isFollowing: false, followFeatureReady: true });
    }

    const { error } = await adminClient.from("user_follows").upsert({
      follower_id: user.id,
      followed_id: targetUserId,
    });

    if (error) {
      if (isMissingUserFollowsTable(error)) {
        return NextResponse.json(
          { error: "Follow feature is not ready yet. Please run the user_follows migration.", followFeatureReady: false },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ isFollowing: true, followFeatureReady: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update follow state." }, { status: 500 });
  }
}
