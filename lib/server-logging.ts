import { randomUUID } from "crypto";

import { NextRequest } from "next/server";

type LogMetadata = Record<string, unknown>;

export function serializeError(error: unknown): LogMetadata {
  if (error instanceof Error) {
    const enrichedError = error as Error & {
      code?: string;
      details?: string;
      hint?: string;
      status?: number;
      digest?: string;
      cause?: unknown;
    };

    return {
      name: enrichedError.name,
      message: enrichedError.message,
      code: enrichedError.code ?? null,
      details: enrichedError.details ?? null,
      hint: enrichedError.hint ?? null,
      status: enrichedError.status ?? null,
      digest: enrichedError.digest ?? null,
      stack: enrichedError.stack ?? null,
      cause: enrichedError.cause ? serializeError(enrichedError.cause) : null,
    };
  }

  if (typeof error === "object" && error !== null) {
    return error as LogMetadata;
  }

  return { message: String(error) };
}

export function createRequestLogContext(
  req: NextRequest | Request,
  scope: string,
  extras: LogMetadata = {}
) {
  const requestId = req.headers.get("x-vercel-id") || randomUUID();
  let pathname: string | null = null;
  let search: string | null = null;

  try {
    const url = new URL(req.url);
    pathname = url.pathname;
    search = url.search || null;
  } catch {
    pathname = null;
    search = null;
  }

  return {
    scope,
    requestId,
    method: req.method,
    path: pathname,
    search,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    ...extras,
  };
}

export function logInfo(scope: string, message: string, metadata: LogMetadata = {}) {
  console.info(`[${scope}] ${message}`, metadata);
}

export function logWarn(scope: string, message: string, metadata: LogMetadata = {}) {
  console.warn(`[${scope}] ${message}`, metadata);
}

export function logError(scope: string, message: string, error: unknown, metadata: LogMetadata = {}) {
  console.error(`[${scope}] ${message}`, {
    ...metadata,
    error: serializeError(error),
  });
}