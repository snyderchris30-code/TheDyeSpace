import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const AUTH_ROUTES = new Set(['/login', '/signup', '/auth/forgot-password']);
const PROTECTED_ROUTE_PREFIXES = ['/create', '/notifications'];
const PROTECTED_EXACT_ROUTES = new Set(['/profile']);

function isProtectedPath(pathname: string) {
  if (PROTECTED_EXACT_ROUTES.has(pathname)) {
    return true;
  }

  return PROTECTED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let user = null;
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch (error) {
    // Suppress refresh token errors - user is not authenticated or session is invalid
    // Continue with user = null for proper redirect handling
  }

  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && AUTH_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
