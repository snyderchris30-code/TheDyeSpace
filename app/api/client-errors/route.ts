import { NextRequest, NextResponse } from "next/server";

import { createRequestLogContext, logError, logWarn } from "@/lib/server-logging";

export async function POST(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "client-errors");

  try {
    const body = await req.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      logWarn("client-errors", "Received invalid client error payload", requestContext);
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    logError(
      "client-errors",
      typeof body.message === "string" ? body.message : "Client-side error forwarded to server logs",
      body.error ?? body,
      {
        ...requestContext,
        stage: typeof body.stage === "string" ? body.stage : null,
        routeUsername: typeof body.routeUsername === "string" ? body.routeUsername : null,
        sessionUserId: typeof body.sessionUserId === "string" ? body.sessionUserId : null,
        profileUserId: typeof body.profileUserId === "string" ? body.profileUserId : null,
        href: typeof body.href === "string" ? body.href : null,
        userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
        details: body.details && typeof body.details === "object" ? body.details : null,
      }
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    logError("client-errors", "Failed to process client error payload", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to process client error payload." },
      { status: 500 }
    );
  }
}