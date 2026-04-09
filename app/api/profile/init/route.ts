import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/admin-utils";
import { ensureProfileForUser } from "@/lib/profile-bootstrap";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const requestContext = createRequestLogContext(req, "profile/init");

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("profile/init", "Unauthorized profile init request", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      logError("profile/init", "Missing service role configuration", error, {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json({ error: "Server misconfiguration: service role key missing" }, { status: 500 });
    }

    const requestPayload = await req.json().catch(() => ({} as any));
    logInfo("profile/init", "Initializing profile", {
      ...requestContext,
      userId: user.id,
      requestedUsername: typeof requestPayload.username === "string" ? requestPayload.username : null,
    });

    const ensuredProfile = await ensureProfileForUser(adminClient, user, {
      username: typeof requestPayload.username === "string" ? requestPayload.username : null,
      displayName: typeof requestPayload.display_name === "string" ? requestPayload.display_name : null,
    });

    if (ensuredProfile.autoFollowError) {
      logWarn("profile/init", "Admin auto-follow skipped", {
        ...requestContext,
        userId: user.id,
        error:
          ensuredProfile.autoFollowError instanceof Error
            ? ensuredProfile.autoFollowError.message
            : String(ensuredProfile.autoFollowError),
      });
    }

    logInfo("profile/init", "Profile initialized", {
      ...requestContext,
      userId: user.id,
      createdProfile: ensuredProfile.createdProfile,
      resolvedUsername: ensuredProfile.resolvedUsername,
    });

    return NextResponse.json({ profile: ensuredProfile.profile });
  } catch (error: any) {
    logError("profile/init", "Unexpected profile init failure", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to initialize profile." },
      { status: 500 }
    );
  }
}
