import { NextRequest, NextResponse } from "next/server";

import { createCaptchaChallenge, verifyCaptchaSelection } from "@/lib/security/captcha";
import { createRequestLogContext, logError, logWarn } from "@/lib/server-logging";

export async function GET(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "captcha/challenge");

  try {
    const challenge = await createCaptchaChallenge();
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("captcha/challenge", "Failed to create challenge", error, requestContext);
    return NextResponse.json({ error: "Failed to create CAPTCHA challenge." }, { status: 500 });
  }
}

type VerifyBody = {
  token?: string;
  selectedIds?: string[];
};

export async function POST(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "captcha/verify");

  try {
    const body = (await req.json().catch(() => ({}))) as VerifyBody;
    const token = typeof body.token === "string" ? body.token : "";
    const selectedIds = Array.isArray(body.selectedIds)
      ? body.selectedIds.filter((value): value is string => typeof value === "string")
      : [];

    console.log("[CAPTCHA] verify request", {
      tokenPresent: Boolean(token),
      selectedCount: selectedIds.length,
    });

    if (!token) {
      console.warn("[CAPTCHA] verify missing token", requestContext);
      return NextResponse.json({ error: "CAPTCHA token is required." }, { status: 400 });
    }

    const verification = verifyCaptchaSelection(token, selectedIds);
    if (!verification.ok) {
      logWarn("captcha/verify", "CAPTCHA verification failed", {
        ...requestContext,
        reason: verification.reason,
        selectedCount: selectedIds.length,
      });
      console.log("[CAPTCHA] verify failed", {
        reason: verification.reason,
        selectedCount: selectedIds.length,
      });
      return NextResponse.json({ ok: false, reason: verification.reason }, { status: 200 });
    }

    console.log("[CAPTCHA] verify succeeded", { selectedCount: selectedIds.length });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("captcha/verify", "Unexpected CAPTCHA verification failure", error, requestContext);
    console.error("[CAPTCHA] verify exception", error);
    return NextResponse.json({ error: "Failed to verify CAPTCHA." }, { status: 500 });
  }
}
