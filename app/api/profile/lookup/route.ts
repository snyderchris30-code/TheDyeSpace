import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/admin-utils";
import { hasAdminAccess } from "@/lib/admin-actions";
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
    let viewerIsAdmin = false;

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

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    viewer = authError ? null : user;

    if (viewer?.id) {
      const { data: viewerProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("id", viewer.id)
        .limit(1)
        .maybeSingle();
      viewerIsAdmin = hasAdminAccess(viewer.id, viewerProfile?.role ?? null);
    }

    logInfo("profile/lookup", "Profile fetch started", {
      ...requestContext,
      username,
      viewerUserId: viewer?.id ?? null,
    });

    let profile = await loadProfileByUsername(adminClient, username);
    let createdProfile = false;

    if (!profile) {
      // viewer already resolved above
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

    if (profile?.ghost_ridin === true) {
      const viewerIsOwner = Boolean(viewer?.id && viewer.id === profile.id);
      if (!viewerIsAdmin && !viewerIsOwner) {
        logWarn("profile/lookup", "Ghost profile hidden from non-admin viewer", {
          ...requestContext,
          username,
          viewerUserId: viewer?.id ?? null,
        });
        return NextResponse.json({ profile: null, meta: { createdProfile: false, notFound: true, hidden: true } });
      }
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
