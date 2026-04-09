import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/admin-utils";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatSellerContactDetails,
  hasSellerContactDetails,
  resolveSellerContactSettings,
  type VerifiedSellerContactRequestStatus,
} from "@/lib/verified-seller";

type ProfileLookup = {
  id: string;
  username: string | null;
  display_name: string | null;
  verified_badge?: boolean | null;
  theme_settings?: Record<string, unknown> | null;
};

type ContactRequestRow = {
  id: string;
  seller_user_id: string;
  requester_user_id: string;
  status: VerifiedSellerContactRequestStatus;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
};

type PendingContactRequest = {
  id: string;
  status: VerifiedSellerContactRequestStatus;
  created_at: string;
  requester: {
    id: string;
    username: string | null;
    display_name: string | null;
  };
};

type PatchBody = {
  requestId?: string;
  action?: "approve" | "deny";
};

function isMissingContactRequestsTableError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return code === "42P01" || /verified_seller_contact_requests/i.test(message);
}

async function createNotification(adminClient: ReturnType<typeof createAdminClient>, payload: Record<string, unknown>) {
  const { data, error } = await adminClient
    .from("notifications")
    .insert(payload)
    .select("id")
    .limit(1);

  if (!error) {
    return data?.[0]?.id ?? null;
  }

  const cacheError = String(error.message || "").includes("Could not find the 'post_id' column of 'notifications' in the schema cache");
  if (!cacheError) {
    throw error;
  }

  const fallbackPayload = { ...payload };
  delete fallbackPayload.post_id;

  const { data: fallbackData, error: fallbackError } = await adminClient
    .from("notifications")
    .insert(fallbackPayload)
    .select("id")
    .limit(1);

  if (fallbackError) {
    throw fallbackError;
  }

  return fallbackData?.[0]?.id ?? null;
}

async function loadProfile(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, verified_badge, theme_settings")
    .eq("id", userId)
    .limit(1)
    .maybeSingle<ProfileLookup>();

  if (error) {
    throw error;
  }

  return data;
}

function resolveActorName(profile: ProfileLookup | null | undefined, user: { email?: string | null; id?: string | null; user_metadata?: Record<string, unknown> | null }) {
  return (
    profile?.display_name?.trim() ||
    resolveProfileUsername(
      profile?.username,
      typeof user.user_metadata?.username === "string" ? user.user_metadata.username : null,
      user.email,
      user.id
    )
  );
}

async function loadPendingRequests(adminClient: ReturnType<typeof createAdminClient>, sellerUserId: string) {
  const { data, error } = await adminClient
    .from("verified_seller_contact_requests")
    .select("id, seller_user_id, requester_user_id, status, created_at, updated_at, responded_at")
    .eq("seller_user_id", sellerUserId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data || []) as ContactRequestRow[];
  if (!rows.length) {
    return [] as PendingContactRequest[];
  }

  const requesterIds = Array.from(new Set(rows.map((row) => row.requester_user_id)));
  const { data: requesterProfiles, error: requesterError } = await adminClient
    .from("profiles")
    .select("id, username, display_name")
    .in("id", requesterIds);

  if (requesterError) {
    throw requesterError;
  }

  const requesterById = new Map(
    ((requesterProfiles || []) as Array<Pick<ProfileLookup, "id" | "username" | "display_name">>).map((profile) => [profile.id, profile])
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    requester: {
      id: row.requester_user_id,
      username: requesterById.get(row.requester_user_id)?.username ?? null,
      display_name: requesterById.get(row.requester_user_id)?.display_name ?? null,
    },
  }));
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ authenticated: false, featureReady: true, pendingRequests: [], requestStatus: null });
  }

  try {
    const adminClient = createAdminClient();
    const viewerProfile = await loadProfile(adminClient, user.id);
    const sellerUserId = req.nextUrl.searchParams.get("sellerUserId")?.trim() || null;

    if (!sellerUserId) {
      if (viewerProfile?.verified_badge !== true) {
        return NextResponse.json({ authenticated: true, featureReady: true, pendingRequests: [], contactDetails: null });
      }

      const pendingRequests = await loadPendingRequests(adminClient, user.id);
      return NextResponse.json({ authenticated: true, featureReady: true, pendingRequests, contactDetails: null });
    }

    const sellerProfile = await loadProfile(adminClient, sellerUserId);
    if (!sellerProfile) {
      return NextResponse.json({ error: "Seller not found." }, { status: 404 });
    }

    if (sellerUserId === user.id) {
      const pendingRequests = sellerProfile.verified_badge === true ? await loadPendingRequests(adminClient, user.id) : [];
      return NextResponse.json({
        authenticated: true,
        featureReady: true,
        sellerVerified: sellerProfile.verified_badge === true,
        viewerVerified: viewerProfile?.verified_badge === true,
        pendingRequests,
        requestStatus: null,
        contactDetails: null,
      });
    }

    let requestStatus: VerifiedSellerContactRequestStatus | null = null;

    try {
      const { data: existingRequest, error: existingError } = await adminClient
        .from("verified_seller_contact_requests")
        .select("status")
        .eq("seller_user_id", sellerUserId)
        .eq("requester_user_id", user.id)
        .maybeSingle<{ status: VerifiedSellerContactRequestStatus }>();

      if (existingError) {
        throw existingError;
      }

      requestStatus = existingRequest?.status ?? null;
    } catch (error) {
      if (!isMissingContactRequestsTableError(error)) {
        throw error;
      }
      return NextResponse.json({
        authenticated: true,
        featureReady: false,
        sellerVerified: sellerProfile.verified_badge === true,
        viewerVerified: viewerProfile?.verified_badge === true,
        requestStatus: null,
      });
    }

    return NextResponse.json({
      authenticated: true,
      featureReady: true,
      sellerVerified: sellerProfile.verified_badge === true,
      viewerVerified: viewerProfile?.verified_badge === true,
      requestStatus,
      pendingRequests: [],
      contactDetails:
        requestStatus === "approved"
          ? formatSellerContactDetails(resolveSellerContactSettings(sellerProfile.theme_settings ?? null)) || null
          : null,
    });
  } catch (error: any) {
    if (isMissingContactRequestsTableError(error)) {
      return NextResponse.json({ authenticated: true, featureReady: false, pendingRequests: [], requestStatus: null, contactDetails: null });
    }

    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load contact requests." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { sellerUserId?: string };
  const sellerUserId = typeof body?.sellerUserId === "string" ? body.sellerUserId.trim() : "";

  if (!sellerUserId) {
    return NextResponse.json({ error: "sellerUserId is required." }, { status: 400 });
  }

  if (sellerUserId === user.id) {
    return NextResponse.json({ error: "You cannot request your own contact info." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const [requesterProfile, sellerProfile] = await Promise.all([
      loadProfile(adminClient, user.id),
      loadProfile(adminClient, sellerUserId),
    ]);

    if (!sellerProfile || sellerProfile.verified_badge !== true) {
      return NextResponse.json({ error: "This seller is not accepting contact info requests." }, { status: 400 });
    }

    if (requesterProfile?.verified_badge === true) {
      return NextResponse.json({ error: "Verified Sellers cannot use the buyer contact request flow." }, { status: 403 });
    }

    const { data: existingRequest, error: existingError } = await adminClient
      .from("verified_seller_contact_requests")
      .select("id, status")
      .eq("seller_user_id", sellerUserId)
      .eq("requester_user_id", user.id)
      .maybeSingle<{ id: string; status: VerifiedSellerContactRequestStatus }>();

    if (existingError) {
      throw existingError;
    }

    if (existingRequest?.status === "pending") {
      return NextResponse.json({ ok: true, requestStatus: "pending" satisfies VerifiedSellerContactRequestStatus });
    }

    const now = new Date().toISOString();

    if (existingRequest) {
      const { error: updateError } = await adminClient
        .from("verified_seller_contact_requests")
        .update({ status: "pending", created_at: now, updated_at: now, responded_at: null })
        .eq("id", existingRequest.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      const { error: insertError } = await adminClient.from("verified_seller_contact_requests").insert({
        seller_user_id: sellerUserId,
        requester_user_id: user.id,
        status: "pending",
      });

      if (insertError) {
        throw insertError;
      }
    }

    const requesterName = resolveActorName(requesterProfile, user);
    await createNotification(adminClient, {
      user_id: sellerUserId,
      actor_name: requesterName,
      type: "seller_contact_request",
      post_id: null,
      message: `${requesterName} requested your contact information.`,
      read: false,
    });

    return NextResponse.json({ ok: true, requestStatus: "pending" satisfies VerifiedSellerContactRequestStatus });
  } catch (error: any) {
    if (isMissingContactRequestsTableError(error)) {
      return NextResponse.json({ error: "Contact request feature is not ready yet. Please run the latest migration.", featureReady: false }, { status: 503 });
    }

    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to submit contact request." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const action = body.action === "deny" ? "deny" : body.action === "approve" ? "approve" : null;

  if (!requestId || !action) {
    return NextResponse.json({ error: "requestId and action are required." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const sellerProfile = await loadProfile(adminClient, user.id);

    if (sellerProfile?.verified_badge !== true) {
      return NextResponse.json({ error: "Only Verified Sellers can respond to contact requests." }, { status: 403 });
    }

    const { data: requestRow, error: requestError } = await adminClient
      .from("verified_seller_contact_requests")
      .select("id, seller_user_id, requester_user_id, status, created_at, updated_at, responded_at")
      .eq("id", requestId)
      .maybeSingle<ContactRequestRow>();

    if (requestError) {
      throw requestError;
    }

    if (!requestRow || requestRow.seller_user_id !== user.id) {
      return NextResponse.json({ error: "Contact request not found." }, { status: 404 });
    }

    const nextStatus = action === "approve" ? "approved" : "denied";

    if (nextStatus === "approved") {
      const sellerSettings = resolveSellerContactSettings(sellerProfile.theme_settings ?? null);
      if (!hasSellerContactDetails(sellerSettings)) {
        return NextResponse.json({ error: "Add at least one contact detail or buyer message before approving requests." }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("verified_seller_contact_requests")
      .update({ status: nextStatus, updated_at: now, responded_at: now })
      .eq("id", requestId);

    if (updateError) {
      throw updateError;
    }

    const requesterProfile = await loadProfile(adminClient, requestRow.requester_user_id);
    const sellerName = resolveActorName(sellerProfile, user);
    const sellerSettings = resolveSellerContactSettings(sellerProfile.theme_settings ?? null);

    await createNotification(adminClient, {
      user_id: requestRow.requester_user_id,
      actor_name: sellerName,
      type: nextStatus === "approved" ? "seller_contact_request_approved" : "seller_contact_request_denied",
      post_id: null,
      message:
        nextStatus === "approved"
          ? `${sellerName} approved your contact info request.\n${formatSellerContactDetails(sellerSettings)}`
          : `${sellerName} denied your contact info request.`,
      read: false,
    });

    const pendingRequests = await loadPendingRequests(adminClient, user.id);

    return NextResponse.json({
      ok: true,
      pendingRequests,
      requestStatus: nextStatus,
      requester: requesterProfile
        ? {
            id: requesterProfile.id,
            username: requesterProfile.username,
            display_name: requesterProfile.display_name,
          }
        : null,
    });
  } catch (error: any) {
    if (isMissingContactRequestsTableError(error)) {
      return NextResponse.json({ error: "Contact request feature is not ready yet. Please run the latest migration.", featureReady: false }, { status: 503 });
    }

    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to update contact request." },
      { status: 500 }
    );
  }
}