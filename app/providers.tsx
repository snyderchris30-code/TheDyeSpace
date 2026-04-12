'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/app-config';
import { MusicPlayerProvider } from './MusicPlayerContext';

function FreshDataRuntime() {
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
            staleTime: 1000 * 30,
            gcTime: 1000 * 60 * 5,
            refetchOnMount: false,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MusicPlayerProvider>
        <FreshDataRuntime />
        {children}
      </MusicPlayerProvider>
    </QueryClientProvider>
  );
}
