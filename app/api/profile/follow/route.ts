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

async function createFollowNotification(
  adminClient: ReturnType<typeof createAdminClient>,
  followedId: string,
  followerId: string,
  actorHandle: string
) {
  if (!followedId || !followerId || followedId === followerId) {
    return;
  }

  const { data: existingNotification } = await adminClient
    .from("notifications")
    .select("id")
    .eq("user_id", followedId)
    .eq("actor_name", actorHandle)
    .eq("type", "follow")
    .limit(1)
    .maybeSingle();

  if (existingNotification) {
    return;
  }

  const payload = {
    user_id: followedId,
    actor_name: actorHandle,
    type: "follow",
    post_id: null,
    message: `@${actorHandle} started following you.`,
    read: false,
  };

  let data: Array<{ id: string }> | null = null;

  const { data: firstData, error } = await adminClient
    .from("notifications")
    .insert(payload)
    .select("id")
    .limit(1);

  data = firstData as Array<{ id: string }> | null;

  if (error) {
    const cacheError = String(error.message || "").includes(
      "Could not find the 'post_id' column of 'notifications' in the schema cache"
    );

    if (cacheError) {
      const fallbackPayload = { ...payload };
      delete (fallbackPayload as Record<string, unknown>).post_id;
      const { data: fallbackData, error: fallbackError } = await adminClient
        .from("notifications")
        .insert(fallbackPayload)
        .select("id")
        .limit(1);

      if (!fallbackError) {
        data = fallbackData as Array<{ id: string }> | null;
      } else {
        console.error("[notifications] Failed to create follow notification", {
          followedId,
          followerId,
          error: fallbackError.message,
        });
        return;
      }
    } else {
      console.error("[notifications] Failed to create follow notification", {
        followedId,
        followerId,
        error: error.message,
      });
      return;
    }
  }

  void data;
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

    const { data: existingFollow, error: existingFollowError } = await adminClient
      .from("user_follows")
      .select("follower_id")
      .eq("follower_id", user.id)
      .eq("followed_id", targetUserId)
      .maybeSingle();

    if (existingFollowError) {
      if (isMissingUserFollowsTable(existingFollowError)) {
        return NextResponse.json(
          { error: "Follow feature is not ready yet. Please run the user_follows migration.", followFeatureReady: false },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: existingFollowError.message }, { status: 500 });
    }

    const isNewFollow = !existingFollow;

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

    if (isNewFollow) {
      const { data: actorProfile } = await adminClient
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle();

      const actorName =
        (actorProfile?.username?.trim() ||
          user.user_metadata?.username ||
          user.email ||
          "A user").replace(/^@+/, "");

      await createFollowNotification(adminClient, targetUserId, user.id, actorName);
    }

    return NextResponse.json({ isFollowing: true, followFeatureReady: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update follow state." }, { status: 500 });
  }
}
