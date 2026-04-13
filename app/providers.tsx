'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/app-config';
import { MusicPlayerProvider } from './MusicPlayerContext';

const RECENT_API_RESPONSE_TTL_MS = 1200;

type CachedApiResponse = {
  expiresAt: number;
  response: Response;
};

function FreshDataRuntime() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const inFlightApiRequests = new Map<string, Promise<Response>>();
    const recentApiResponses = new Map<string, CachedApiResponse>();

    const pruneRecentResponses = (now: number) => {
      for (const [key, entry] of recentApiResponses.entries()) {
        if (entry.expiresAt <= now) {
          recentApiResponses.delete(key);
        }
      }
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const request = input instanceof Request ? input : null;
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(rawUrl, window.location.origin);
        const sameOrigin = url.origin === window.location.origin;
        const isApiCall = url.pathname.startsWith('/api/');
        const isStaticAsset = /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|json|webmanifest|mp4|woff2?)$/i.test(url.pathname);
        const method = (init?.method || request?.method || 'GET').toUpperCase();
        const isSafeApiRequest =
          sameOrigin &&
          isApiCall &&
          ((method === 'GET' || method === 'HEAD') || (method === 'POST' && url.pathname === '/api/profile/init')) &&
          !init?.signal;

        if (sameOrigin && (isApiCall || isStaticAsset)) {
          url.searchParams.set('v', APP_VERSION);
          const nextInit: RequestInit = {
            ...init,
          };

          const nextInput = request ? new Request(url.toString(), request) : url.toString();

          if (isSafeApiRequest) {
            const now = Date.now();
            pruneRecentResponses(now);

            const dedupeUrl = new URL(url.toString());
            for (const ignoreParam of ['cacheBust', 't', '_', 'v']) {
              dedupeUrl.searchParams.delete(ignoreParam);
            }
            const requestKey = `${method}:${dedupeUrl.toString()}`;
            const cached = recentApiResponses.get(requestKey);
            if (cached && cached.expiresAt > now) {
              return cached.response.clone();
            }

            const pending = inFlightApiRequests.get(requestKey);
            if (pending) {
              const response = await pending;
              return response.clone();
            }

            const requestPromise = originalFetch(nextInput, nextInit);
            inFlightApiRequests.set(requestKey, requestPromise);

            try {
              const response = await requestPromise;

              if (response.ok) {
                recentApiResponses.set(requestKey, {
                  expiresAt: now + RECENT_API_RESPONSE_TTL_MS,
                  response,
                });
              }

              return response.clone();
            } finally {
              if (inFlightApiRequests.get(requestKey) === requestPromise) {
                inFlightApiRequests.delete(requestKey);
              }
            }
          }

          return originalFetch(nextInput, nextInit);
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
