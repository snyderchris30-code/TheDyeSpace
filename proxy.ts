// --- DOMAIN REDIRECT AND LOGGING ---
const CURRENT_DOMAINS = [
  'www.thedyespace.com',
  'thedyespace.com',
  'www.thedyespace.app',
  'thedyespace.app',
];

export function logProjectAndRedirect(request: NextRequest) {
  const host = request.headers.get('host');
  console.log('[PROXY] Host:', host, '| URL:', request.nextUrl.href);

  // If not on the current domain, redirect to www.thedyespace.com
  if (host && !CURRENT_DOMAINS.includes(host)) {
    const url = request.nextUrl.clone();
    url.hostname = 'www.thedyespace.com';
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }
  return null;
}
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { applyRateLimit, getClientIp, hasSuspiciousInput } from '@/lib/security/request-guards';

const REDIRECT_IF_AUTH_ROUTES = new Set(['/signup']);
const PUBLIC_ROUTES = new Set(['/login', '/forgot-password', '/reset-password']);
const PROTECTED_ROUTE_PREFIXES = ['/create', '/notifications'];
const PROTECTED_EXACT_ROUTES = new Set<string>(['/profile']);
const BLOCKED_ATTACK_PATHS = new Set(['/xmlrpc.php', '/wp-admin', '/wp-login.php']);

function isProtectedPath(pathname: string) {
  if (PROTECTED_EXACT_ROUTES.has(pathname)) {
    return true;
  }

  return PROTECTED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ip = getClientIp(request);

  if (BLOCKED_ATTACK_PATHS.has(pathname) || pathname.startsWith('/wp-admin/')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const suspiciousSource = `${pathname}${request.nextUrl.search || ''}`;
  if (hasSuspiciousInput(suspiciousSource)) {
    const response = NextResponse.json({ error: 'Suspicious request blocked.' }, { status: 403 });
    // Best effort: invalidate Supabase session cookies on suspicious activity.
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith('sb-')) {
        response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' });
      }
    }
    console.warn('[proxy] Suspicious request blocked', { pathname, ip });
    return response;
  }

  if (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/api/posts/create' ||
    pathname === '/api/posts/comments' ||
    pathname === '/api/profile/init'
  ) {
    const limiter = applyRateLimit({
      key: `proxy:${pathname}:${ip}`,
      windowMs: 60_000,
      max: pathname.startsWith('/api/') ? 12 : 15,
      blockMs: 5 * 60_000,
    });

    if (!limiter.allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Too many requests. Please slow down.' },
          { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } }
        );
      }

      return new NextResponse('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(limiter.retryAfterSeconds) },
      });
    }
  }

  // Log and redirect if needed
  const redirectResponse = logProjectAndRedirect(request);
  if (redirectResponse) return redirectResponse;

  // Only run Supabase auth checks on routes that actually need auth-aware behavior.
  if (!isProtectedPath(pathname) && !REDIRECT_IF_AUTH_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
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
    // Suppress refresh token errors - user is not authenticated or session is invalid
    // Continue with user = null for proper redirect handling
  }

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && REDIRECT_IF_AUTH_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|robots.txt|sitemap.xml|icons|emojis|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?|ttf)$).*)',
    '/api/posts/create',
    '/api/posts/comments',
    '/api/profile/init',
  ],
};
