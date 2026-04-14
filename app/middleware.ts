'use server';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 90;
const DUPLICATE_WINDOW_MS = 7_500;
const DUPLICATE_MAX = 4;
const DUPLICATE_SLOWDOWN_MS = 650;

type RateLimitEntry = {
  count: number;
  firstRequestAt: number;
};

type DuplicateEntry = {
  count: number;
  firstRequestAt: number;
  lastRequestAt: number;
};

const retries = new Map<string, RateLimitEntry>();
const duplicateRequests = new Map<string, DuplicateEntry>();

const BOT_SENSITIVE_PATHS = new Set([
  '/',
  '/explore',
  '/login',
  '/api/posts/feed',
  '/api/posts/interactions',
]);

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const clientIp = request.headers.get('x-client-ip');
  if (clientIp) {
    return clientIp.trim();
  }

  return 'unknown';
}

function cleanupStaleEntries(now: number) {
  for (const [key, value] of retries) {
    if (now - value.firstRequestAt > RATE_LIMIT_WINDOW_MS * 2) {
      retries.delete(key);
    }
  }

  for (const [key, value] of duplicateRequests) {
    if (now - value.lastRequestAt > DUPLICATE_WINDOW_MS * 2) {
      duplicateRequests.delete(key);
    }
  }
}

function buildRequestSignature(request: NextRequest, ip: string) {
  const path = request.nextUrl.pathname;
  const normalizedQuery = request.nextUrl.searchParams.toString();
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `${ip}|${request.method}|${path}|${normalizedQuery}|${userAgent}`;
}

function shouldInspectDuplicates(pathname: string) {
  if (BOT_SENSITIVE_PATHS.has(pathname)) {
    return true;
  }
  return pathname.startsWith('/api/posts/interactions') || pathname.startsWith('/api/posts/feed');
}

function isRateLimited(ip: string, now: number) {
  const entry = retries.get(ip);
  if (!entry) {
    retries.set(ip, { count: 1, firstRequestAt: now });
    return false;
  }

  if (now - entry.firstRequestAt > RATE_LIMIT_WINDOW_MS) {
    retries.set(ip, { count: 1, firstRequestAt: now });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return true;
  }

  return false;
}

function getDuplicateRequestState(signature: string, now: number) {
  const entry = duplicateRequests.get(signature);
  if (!entry || now - entry.firstRequestAt > DUPLICATE_WINDOW_MS) {
    const nextEntry: DuplicateEntry = {
      count: 1,
      firstRequestAt: now,
      lastRequestAt: now,
    };
    duplicateRequests.set(signature, nextEntry);
    return nextEntry;
  }

  entry.count += 1;
  entry.lastRequestAt = now;
  return entry;
}

export async function middleware(request: NextRequest) {
  const now = Date.now();
  cleanupStaleEntries(now);

  const ip = getClientIp(request);
  const pathname = request.nextUrl.pathname;

  if (isRateLimited(ip, now)) {
    console.warn(`[rate-limit] 429 ${request.nextUrl.pathname} ip=${ip} count=${retries.get(ip)?.count ?? 'unknown'}`);
    const response = new NextResponse('Too many requests', {
      status: 429,
      statusText: 'Too Many Requests',
    });
    response.headers.set('Retry-After', '60');
    return response;
  }

  if (shouldInspectDuplicates(pathname)) {
    const signature = buildRequestSignature(request, ip);
    const duplicateState = getDuplicateRequestState(signature, now);

    if (duplicateState.count > DUPLICATE_MAX) {
      console.warn(
        `[duplicate-throttle] 429 ${pathname} ip=${ip} duplicateCount=${duplicateState.count} windowMs=${DUPLICATE_WINDOW_MS}`
      );
      const response = new NextResponse('Too many duplicate requests', {
        status: 429,
        statusText: 'Too Many Requests',
      });
      response.headers.set('Retry-After', '8');
      return response;
    }

    if (duplicateState.count >= 3) {
      await new Promise((resolve) => setTimeout(resolve, DUPLICATE_SLOWDOWN_MS));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/explore',
    '/login',
    '/create',
    '/profile/:path*',
    '/api/posts/feed',
    '/api/posts/interactions',
  ],
};
