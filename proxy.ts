import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  applyRateLimit,
  getClientIp,
  hasSuspiciousInput,
  isBlockedAttackPath,
  isSuspiciousUserAgent,
} from '@/lib/security/request-guards';

const REDIRECT_IF_AUTH_ROUTES = new Set(['/signup']);
const PUBLIC_ROUTES = new Set(['/login', '/forgot-password', '/reset-password']);
const PROTECTED_ROUTE_PREFIXES = ['/create', '/notifications'];
const PROTECTED_EXACT_ROUTES = new Set<string>(['/profile']);
const BLOCKED_ATTACK_PATHS = new Set([
  '/xmlrpc.php',
  '/wp-admin',
  '/wp-login',
  '/wp-login.php',
  '/wp-json',
  '/.env',
  '/.git',
  '/config',
  '/backup',
  '/install.php',
  '/phpinfo.php',
  '/admin.php',
]);
const BLOCKED_RECON_PATH_PREFIXES = ['/.env', '/.ssh', '/dump', '/.aws', '/.docker', '/_zz_catchall', '/.git', '/backup', '/config'] as const;
const BURST_RATE_LIMIT_EXACT = new Set(['/', '/explore', '/login', '/create', '/signup']);
const BURST_RATE_LIMIT_PREFIXES = ['/profile', '/api', '/notifications'];
const BURST_RATE_LIMIT_WINDOW_MS = 10_000;
const BURST_RATE_LIMIT_MAX = 20;

const SECURE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
} as const;

function withSecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function clearSupabaseCookies(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith('sb-')) {
      continue;
    }

    try {
      request.cookies.set(cookie.name, '');
    } catch {
      // Ignore request cookie mutation errors in middleware.
    }

    response.cookies.set(cookie.name, '', {
      maxAge: 0,
      path: '/',
    });
  }
}

function isProtectedPath(pathname: string) {
  if (PROTECTED_EXACT_ROUTES.has(pathname)) {
    return true;
  }

  return PROTECTED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent');

  if (isSuspiciousUserAgent(userAgent)) {
    console.warn('[proxy] Suspicious user-agent blocked', { pathname, ip, userAgent: userAgent ?? 'missing' });
    return withSecurityHeaders(new NextResponse('Forbidden', { status: 403 }));
  }

  if (BLOCKED_RECON_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withSecurityHeaders(new NextResponse('Not found', { status: 404 }));
  }

  if (
    BLOCKED_ATTACK_PATHS.has(pathname) ||
    isBlockedAttackPath(pathname) ||
    pathname.startsWith('/wp-admin/') ||
    pathname.startsWith('/wp-json/') ||
    pathname.endsWith('.bak') ||
    pathname.endsWith('.sql')
  ) {
    return withSecurityHeaders(new NextResponse('Not found', { status: 404 }));
  }

  const isBurstRoute = BURST_RATE_LIMIT_EXACT.has(pathname) || BURST_RATE_LIMIT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isBurstRoute) {
    let routeKey = pathname;
    if (pathname.startsWith('/api/')) {
      routeKey = '/api';
    } else if (pathname.startsWith('/profile/')) {
      routeKey = '/profile';
    }

    const limiter = applyRateLimit({
      key: `proxy:burst:${routeKey}:${ip}`,
      windowMs: BURST_RATE_LIMIT_WINDOW_MS,
      max: BURST_RATE_LIMIT_MAX,
      blockMs: BURST_RATE_LIMIT_WINDOW_MS,
    });

    if (!limiter.allowed) {
      console.warn('[proxy] Burst rate limit exceeded', { pathname, ip, routeKey, retryAfterSeconds: limiter.retryAfterSeconds });
      return withSecurityHeaders(new NextResponse('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(limiter.retryAfterSeconds) },
      }));
    }
  }

  const suspiciousSource = `${pathname}${request.nextUrl.search || ''}`;
  if (hasSuspiciousInput(suspiciousSource)) {
    const response = NextResponse.json({ error: 'Suspicious request blocked.' }, { status: 403 });
    clearSupabaseCookies(request, response);
    console.warn('[proxy] Suspicious request blocked', { pathname, ip });
    return withSecurityHeaders(response);
  }

  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/api/captcha' ||
    pathname === '/api/posts/create' ||
    pathname === '/api/posts/comments' ||
    pathname === '/api/profile/init'
  ) {
    const limiter = applyRateLimit({
      key: `proxy:${pathname}:${ip}`,
      windowMs: 60_000,
      max: pathname === '/api/captcha' ? 20 : pathname.startsWith('/api/') ? 12 : 15,
      blockMs: 5 * 60_000,
    });

    if (!limiter.allowed) {
      if (pathname.startsWith('/api/')) {
        return withSecurityHeaders(NextResponse.json(
          { error: 'Too many requests. Please slow down.' },
          { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } }
        ));
      }

      return withSecurityHeaders(new NextResponse('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(limiter.retryAfterSeconds) },
      }));
    }
  }

  // Only run Supabase auth checks on routes that actually need auth-aware behavior.
  if (!isProtectedPath(pathname) && !REDIRECT_IF_AUTH_ROUTES.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (PUBLIC_ROUTES.has(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return withSecurityHeaders(NextResponse.next());
  }

  const response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        } catch {
          // Ignore cookie write errors in middleware and continue request flow.
        }
      },
    },
  });

  let user = null;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (error: any) {
    console.warn("[proxy] Supabase auth.getUser failed", {
      pathname,
      error: typeof error?.message === "string" ? error.message : String(error),
    });
    clearSupabaseCookies(request, response);
    // Continue with user = null for proper redirect handling after clearing stale cookies.
  }

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    clearSupabaseCookies(request, redirectResponse);
    return withSecurityHeaders(redirectResponse);
  }

  if (user && REDIRECT_IF_AUTH_ROUTES.has(pathname)) {
    return withSecurityHeaders(NextResponse.redirect(new URL('/', request.url)));
  }

  return withSecurityHeaders(response);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|robots.txt|sitemap.xml|icons|emojis|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?|ttf)$).*)',
    '/api/:path*',
  ],
};
