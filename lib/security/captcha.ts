import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const CAPTCHA_DIRECTORY = path.join(process.cwd(), "public", "captcha");
const CAPTCHA_FILE_PATTERN = /\.(svg|png|jpe?g|gif|webp)$/i;
const CHALLENGE_SIZE = 6;
const MIN_CORRECT_OPTIONS = 2;
const MAX_CORRECT_OPTIONS = 3;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

type CaptchaQuestion = {
  key: string;
  prompt: string;
  matches: (fileName: string) => boolean;
};

type CaptchaPayload = {
  correctIds: string[];
  expiresAt: number;
};

export type CaptchaOption = {
  id: string;
  src: string;
};

export type CaptchaChallenge = {
  prompt: string;
  options: CaptchaOption[];
  token: string;
};

const CAPTCHA_QUESTIONS: CaptchaQuestion[] = [
  {
    key: "tie-dye",
    prompt: "Click all the tie-dye items",
    matches: (fileName) => fileName.startsWith("tie-dye-"),
  },
  {
    key: "peace",
    prompt: "Select the peace signs",
    matches: (fileName) => fileName.startsWith("peace-"),
  },
  {
    key: "mushroom",
    prompt: "Pick the trippy mushrooms",
    matches: (fileName) => fileName.startsWith("mushroom-"),
  },
  {
    key: "groovy",
    prompt: "Choose the groovy vibes",
    matches: (fileName) => fileName.startsWith("psychedelic-") || fileName.startsWith("groovy-item-"),
  },
  {
    key: "leaves",
    prompt: "Find the mellow leaves",
    matches: (fileName) => fileName.startsWith("leaf-"),
  },
];

function shuffle<T>(items: T[]) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function getCaptchaSecret() {
  const rawSecret =
    process.env.CAPTCHA_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "thedyespace-captcha-fallback-secret";

  return createHash("sha256").update(rawSecret).digest();
}

function encryptPayload(payload: CaptchaPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getCaptchaSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function decryptPayload(token: string): CaptchaPayload | null {
  try {
    const buffer = Buffer.from(token, "base64url");
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", getCaptchaSecret(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted) as CaptchaPayload;
    if (!Array.isArray(parsed.correctIds) || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function listCaptchaFiles() {
  const entries = await fs.readdir(CAPTCHA_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && CAPTCHA_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

export async function createCaptchaChallenge(): Promise<CaptchaChallenge> {
  const files = await listCaptchaFiles();
  const shuffledQuestions = shuffle(CAPTCHA_QUESTIONS);

  for (const question of shuffledQuestions) {
    const matching = files.filter((fileName) => question.matches(fileName));
    const distractors = files.filter((fileName) => !question.matches(fileName));

    if (matching.length < MIN_CORRECT_OPTIONS || distractors.length < 3) {
      continue;
    }

    const correctCount = Math.min(
      matching.length,
      Math.max(MIN_CORRECT_OPTIONS, Math.min(MAX_CORRECT_OPTIONS, Math.floor(Math.random() * 2) + 2))
    );

    const correct = shuffle(matching).slice(0, correctCount);
    const incorrect = shuffle(distractors).slice(0, CHALLENGE_SIZE - correct.length);
    const options = shuffle([...correct, ...incorrect]).map((fileName) => ({
      id: fileName,
      src: `/captcha/${encodeURIComponent(fileName)}`,
    }));

    return {
      prompt: question.prompt,
      options,
      token: encryptPayload({ correctIds: correct.sort(), expiresAt: Date.now() + CHALLENGE_TTL_MS }),
    };
  }

  throw new Error("No CAPTCHA challenge could be generated.");
}

export function verifyCaptchaSelection(token: string, selectedIds: string[]) {
  const payload = decryptPayload(token);
  if (!payload) {
    return { ok: false, reason: "invalid" as const };
  }

  if (payload.expiresAt < Date.now()) {
    return { ok: false, reason: "expired" as const };
  }

  const normalizedSelected = [...new Set(selectedIds.filter((value) => typeof value === "string" && value.trim()))].sort();
  const normalizedCorrect = [...new Set(payload.correctIds)].sort();
  const matchesExactly =
    normalizedSelected.length === normalizedCorrect.length &&
    normalizedSelected.every((value, index) => value === normalizedCorrect[index]);

  return {
    ok: matchesExactly,
    reason: matchesExactly ? ("valid" as const) : ("incorrect" as const),
  };
}
