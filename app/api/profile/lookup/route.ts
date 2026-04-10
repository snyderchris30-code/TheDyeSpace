import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/admin-utils";
import {
  ensureProfileForUser,
  isOwnProfileRouteUsername,
  loadProfileByUsername,
} from "@/lib/profile-bootstrap";
import { sanitizeUsernameInput } from "@/lib/profile-identity";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "profile/lookup");

  try {
    const username = sanitizeUsernameInput(req.nextUrl.searchParams.get("username"));
    if (!username) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 });
    }
    let viewer: {
      id: string;
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
    } | null = null;

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (error) {
      logError("profile/lookup", "Missing service role configuration", error, {
        ...requestContext,
        username,
        viewerUserId: null,
      });
      return NextResponse.json({ error: "Server misconfiguration: service role key missing" }, { status: 500 });
    }

    logInfo("profile/lookup", "Profile fetch started", {
      ...requestContext,
      username,
      viewerUserId: null,
    });

    let profile = await loadProfileByUsername(adminClient, username);
    let createdProfile = false;

    if (!profile) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      viewer = authError ? null : user;
    }

    if (!profile && viewer && isOwnProfileRouteUsername(username, viewer)) {
      const ensuredProfile = await ensureProfileForUser(adminClient, viewer, { username });
      profile = ensuredProfile.profile;
      createdProfile = ensuredProfile.createdProfile;

      if (ensuredProfile.autoFollowError) {
        logWarn("profile/lookup", "Admin auto-follow skipped", {
          ...requestContext,
          username,
          viewerUserId: viewer.id,
          error:
            ensuredProfile.autoFollowError instanceof Error
              ? ensuredProfile.autoFollowError.message
              : String(ensuredProfile.autoFollowError),
        });
      }

      if (createdProfile) {
        logInfo("profile/lookup", "Profile created successfully", {
          ...requestContext,
          username,
          viewerUserId: viewer.id,
          resolvedUsername: ensuredProfile.resolvedUsername,
        });
      }
    }

    if (!profile) {
      logWarn("profile/lookup", "Profile not found", {
        ...requestContext,
        username,
        viewerUserId: viewer?.id ?? null,
      });
      return NextResponse.json({ profile: null, meta: { createdProfile: false, notFound: true } });
    }

    return NextResponse.json({
      profile,
      meta: {
        createdProfile,
        resolvedUsername: typeof profile.username === "string" ? profile.username : null,
        notFound: false,
      },
    });
  } catch (error) {
    logError("profile/lookup", "Unexpected profile lookup failure", error, requestContext);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load profile." },
      { status: 500 }
    );
  }
}
