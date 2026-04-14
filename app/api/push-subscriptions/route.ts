import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPushPublicKey } from "@/lib/push-notifications";

type PushSubscriptionBody = {
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

function normalizeSubscription(body: PushSubscriptionBody) {
  const endpoint = typeof body.subscription?.endpoint === "string" ? body.subscription.endpoint.trim() : "";
  const p256dh = typeof body.subscription?.keys?.p256dh === "string" ? body.subscription.keys.p256dh.trim() : "";
  const auth = typeof body.subscription?.keys?.auth === "string" ? body.subscription.keys.auth.trim() : "";

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return { endpoint, p256dh, auth };
}

async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET() {
  return NextResponse.json({ publicKey: getPushPublicKey() });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as PushSubscriptionBody;
    const subscription = normalizeSubscription(body);
    if (!subscription) {
      return NextResponse.json({ error: "Invalid push subscription payload." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        user_agent: req.headers.get("user-agent") || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save push subscription." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as PushSubscriptionBody;
    const endpoint = typeof body.subscription?.endpoint === "string" ? body.subscription.endpoint.trim() : "";

    if (!endpoint) {
      return NextResponse.json({ error: "Missing push subscription endpoint." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to remove push subscription." },
      { status: 500 }
    );
  }
}