'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { installGlobalFetchDedupe } from '@/lib/dedupe-fetch';
import { MusicPlayerProvider } from './MusicPlayerContext';

if (typeof window !== 'undefined') {
  installGlobalFetchDedupe();
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
      <MusicPlayerProvider>{children}</MusicPlayerProvider>
    </QueryClientProvider>
  );
}
