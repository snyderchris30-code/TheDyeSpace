'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { APP_VERSION } from '@/lib/app-config';

function FreshDataRuntime() {
  const pathname = usePathname();
  const router = useRouter();
  const firstPathRef = useRef(true);

  useEffect(() => {
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }

    router.refresh();
  }, [pathname, router]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(rawUrl, window.location.origin);
        const sameOrigin = url.origin === window.location.origin;
        const isApiCall = url.pathname.startsWith('/api/');
        const isStaticAsset = /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|json|webmanifest|mp4|woff2?)$/i.test(url.pathname);

        if (sameOrigin && (isApiCall || isStaticAsset)) {
          url.searchParams.set('v', APP_VERSION);
          const nextInit: RequestInit = {
            ...init,
            cache: 'no-store',
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              Pragma: 'no-cache',
            },
          };

          return originalFetch(url.toString(), nextInit);
        }
      } catch {
        // Fall through to original fetch if URL normalization fails.
      }

      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            gcTime: 1000 * 60 * 5,
            refetchOnMount: 'always',
            refetchOnReconnect: true,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <FreshDataRuntime />
      {children}
    </QueryClientProvider>
  );
}
