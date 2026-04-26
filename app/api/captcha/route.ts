import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { applyRateLimit, getClientIp } from "@/lib/security/request-guards";
import { createRequestLogContext, logError, logWarn } from "@/lib/server-logging";

type CaptchaQuestion = {
  prompt: string;
  prefixes: string[];
};

type CaptchaTokenPayload = {
  correct: string[];
  expiresAt: number;
};

type VerifyBody = {
  token?: string;
  selectedImages?: string[];
};

const CAPTCHA_DIR = path.join(process.cwd(), "public", "captcha");
const CAPTCHA_TTL_MS = 10 * 60 * 1000;
const QUESTION_BANK: CaptchaQuestion[] = [
  { prompt: "Select the peace signs", prefixes: ["peace-"] },
  { prompt: "Pick the trippy mushrooms", prefixes: ["mushroom-"] },
  { prompt: "Pick the Ricks and bongs bro", prefixes: ["groovy-item-", "psychedelic-"] },
  { prompt: "Pick the leaf", prefixes: ["leaf-"] },
];

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function normalizeName(name: string) {
  return path.basename(name).toLowerCase();
}

async function listCaptchaJpgFiles() {
  const entries = await fs.readdir(CAPTCHA_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jpg"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function encodeToken(payload: CaptchaTokenPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeToken(token: string): CaptchaTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as CaptchaTokenPayload;
    if (!Array.isArray(parsed.correct) || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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
    const allFiles = await listCaptchaJpgFiles();
    const question = shuffle(QUESTION_BANK).find((item) => {
      const matchingCount = allFiles.filter((file) => item.prefixes.some((prefix) => file.toLowerCase().startsWith(prefix))).length;
      return matchingCount >= 2 && allFiles.length - matchingCount >= 3;
    });

    if (!question) {
      throw new Error("No valid Stoned CAPTCHA question could be generated.");
    }

    const matching = allFiles.filter((file) => question.prefixes.some((prefix) => file.toLowerCase().startsWith(prefix)));
    const nonMatching = allFiles.filter((file) => !question.prefixes.some((prefix) => file.toLowerCase().startsWith(prefix)));

    const correct = shuffle(matching).slice(0, Math.min(3, Math.max(2, matching.length)));
    const distractors = shuffle(nonMatching).slice(0, 6 - correct.length);
    const options = shuffle([...correct, ...distractors]).slice(0, 6);

    return NextResponse.json(
      {
        prompt: question.prompt,
        options: options.map((fileName) => ({
          id: fileName,
          src: `/captcha/${encodeURIComponent(fileName)}`,
        })),
        token: encodeToken({
          correct: correct.map(normalizeName).sort(),
          expiresAt: Date.now() + CAPTCHA_TTL_MS,
        }),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (error) {
    logError("captcha/challenge", "Failed to create challenge", error, requestContext);
    return NextResponse.json({ error: "Failed to create Stoned CAPTCHA challenge." }, { status: 500 });
  }
}

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
      { success: false, error: "Too many CAPTCHA attempts. Please wait." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as VerifyBody;
    const token = typeof body.token === "string" ? body.token : "";
    const selectedImages = Array.isArray(body.selectedImages)
      ? body.selectedImages.filter((value): value is string => typeof value === "string")
      : [];

    const normalizedSelected = [...new Set(selectedImages.map(normalizeName).filter(Boolean))].sort();

    if (!token) {
      return NextResponse.json({ success: false, message: "Not quite... try again" }, { status: 200 });
    }

    const payload = decodeToken(token);
    if (!payload) {
      logWarn("captcha/verify", "CAPTCHA verification failed", {
        ...requestContext,
        reason: "invalid",
        selectedCount: normalizedSelected.length,
      });
      return NextResponse.json({ success: false, message: "Not quite... try again" }, { status: 200 });
    }

    if (payload.expiresAt < Date.now()) {
      logWarn("captcha/verify", "CAPTCHA verification failed", {
        ...requestContext,
        reason: "expired",
        selectedCount: normalizedSelected.length,
      });
      return NextResponse.json({ success: false, message: "Not quite... try again" }, { status: 200 });
    }

    const normalizedCorrect = [...new Set(payload.correct.map(normalizeName).filter(Boolean))].sort();
    const isMatch =
      normalizedSelected.length === normalizedCorrect.length &&
      normalizedSelected.every((value, index) => value === normalizedCorrect[index]);

    return NextResponse.json({ success: isMatch, message: isMatch ? "Correct!" : "Not quite... try again" }, { status: 200 });
  } catch (error) {
    logError("captcha/verify", "Unexpected CAPTCHA verification failure", error, requestContext);
    return NextResponse.json({ success: false, message: "Not quite... try again" }, { status: 200 });
  }
}
