'use server';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const retries = new Map<string, { count: number; firstRequestAt: number }>();

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

function isRateLimited(ip: string) {
  const now = Date.now();
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

export function middleware(request: NextRequest) {
  const ip = getClientIp(request);

  if (isRateLimited(ip)) {
    console.warn(`[rate-limit] 429 ${request.nextUrl.pathname} ip=${ip} count=${retries.get(ip)?.count ?? 'unknown'}`);
    const response = new NextResponse('Too many requests', {
      status: 429,
      statusText: 'Too Many Requests',
    });
    response.headers.set('Retry-After', '60');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/explore', '/login', '/create', '/profile/:path*'],
};
