import { NextRequest, NextResponse } from "next/server";

import { createCaptchaChallenge, verifyCaptchaSelection } from "@/lib/security/captcha";
import { applyRateLimit, getClientIp } from "@/lib/security/request-guards";
import { createRequestLogContext, logError, logWarn } from "@/lib/server-logging";

export async function GET(req: NextRequest) {
  const requestContext = createRequestLogContext(req, "captcha/challenge");
  const ip = getClientIp(req);

  const limiter = applyRateLimit({
    key: `captcha:challenge:${ip}`,
    windowMs: 60_000,
    max: 120,
    blockMs: 2 * 60_000,
  });

  if (!limiter.allowed) {
    return NextResponse.json(
      { error: "Too many CAPTCHA refresh requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
    );
  }

  try {
    const challenge = await createCaptchaChallenge();
    return NextResponse.json(challenge, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
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
  const ip = getClientIp(req);

  const limiter = applyRateLimit({
    key: `captcha:verify:${ip}`,
    windowMs: 60_000,
    max: 60,
    blockMs: 2 * 60_000,
  });

  if (!limiter.allowed) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited", error: "Too many CAPTCHA attempts. Please wait." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as VerifyBody;
    const token = typeof body.token === "string" ? body.token : "";
    const selectedIds = Array.isArray(body.selectedIds)
      ? body.selectedIds.filter((value): value is string => typeof value === "string")
      : [];

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
      const messages: Record<string, string> = {
        invalid: "CAPTCHA invalid. Please try again.",
        expired: "The CAPTCHA expired. Try again.",
        incorrect: "Not quite. Please try again.",
      };
      return NextResponse.json(
        { ok: false, reason: verification.reason, message: messages[verification.reason] || "CAPTCHA verification failed." },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, message: "Correct!" });
  } catch (error) {
    logError("captcha/verify", "Unexpected CAPTCHA verification failure", error, requestContext);
    console.error("[CAPTCHA] verify exception", error);
    return NextResponse.json({ error: "Failed to verify CAPTCHA." }, { status: 500 });
  }
}
