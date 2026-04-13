const IGNORE_SEARCH_PARAMS = new Set(['cacheBust', 't', '_', 'v']);
const recentApiResponses = new Map<string, { expiresAt: number; response: Response }>();
const inFlightApiRequests = new Map<string, Promise<Response>>();
let installGlobalFetchDedupeCalled = false;

function createNormalizedRequestKey(input: RequestInfo | URL, init?: RequestInit): string {
  const request = input instanceof Request ? input : null;
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : request?.url || '';
  const url = new URL(rawUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const method = ((init?.method || request?.method || 'GET') as string).toUpperCase();

  const normalized = new URL(url.toString());
  normalized.search = '';
  const sortedEntries = [...url.searchParams.entries()]
    .filter(([key]) => !IGNORE_SEARCH_PARAMS.has(key))
    .sort(([a, aValue], [b, bValue]) => {
      if (a === b) return String(aValue).localeCompare(String(bValue));
      return a.localeCompare(b);
    });
  for (const [key, value] of sortedEntries) {
    normalized.searchParams.append(key, value);
  }

  return `${method}:${normalized.pathname}${normalized.search}`;
}

const ROUTE_DEDUPE_TTL_MS: Record<string, number> = {
  '/api/posts/feed': 3000,
  '/api/posts/interactions': 3000,
  '/api/notifications': 3000,
  '/api/profile/lookup': 30000,
};

function getRouteDedupeTtl(input: RequestInfo | URL, init?: RequestInit): number | undefined {
  const request = input instanceof Request ? input : null;
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : request?.url || '';
  const url = new URL(rawUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  return ROUTE_DEDUPE_TTL_MS[url.pathname];
}

function shouldDedupeRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const request = input instanceof Request ? input : null;
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : request?.url || '';
  const url = new URL(rawUrl, window.location.origin);
  const method = ((init?.method || request?.method || 'GET') as string).toUpperCase();

  return url.origin === window.location.origin && url.pathname.startsWith('/api/') && (method === 'GET' || method === 'HEAD');
}

const originalGlobalFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;

export function installGlobalFetchDedupe(): void {
  if (typeof window === 'undefined' || installGlobalFetchDedupeCalled || !originalGlobalFetch) {
    return;
  }

  installGlobalFetchDedupeCalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldDedupeRequest(input, init)) {
      return originalGlobalFetch(input, init);
    }

    return dedupeFetch(input, init, { cacheTtlMs: 1200 });
  };
}

export async function dedupeFetch(input: RequestInfo | URL, init?: RequestInit, options?: { cacheTtlMs?: number }): Promise<Response> {
  if (typeof window === 'undefined' || !originalGlobalFetch) {
    return fetch(input, init);
  }

  if (!shouldDedupeRequest(input, init)) {
    return originalGlobalFetch(input, init);
  }

  const requestKey = createNormalizedRequestKey(input, init);
  const now = Date.now();
  const cacheTtlMs = options?.cacheTtlMs ?? 1200;

  const cached = recentApiResponses.get(requestKey);
  if (cached && cached.expiresAt > now) {
    return cached.response.clone();
  }

  const pending = inFlightApiRequests.get(requestKey);
  if (pending) {
    const response = await pending;
    return response.clone();
  }

  const signal = init?.signal;
  if (signal?.aborted) {
    throw new DOMException('The user aborted a request.', 'AbortError');
  }

  const requestPromise = originalGlobalFetch(input, init);
  inFlightApiRequests.set(requestKey, requestPromise);

  try {
    const response = await requestPromise;
    if (response.ok) {
      recentApiResponses.set(requestKey, {
        expiresAt: now + cacheTtlMs,
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

export async function dedupeFetchJson<T>(input: RequestInfo | URL, init?: RequestInit, options?: { cacheTtlMs?: number }): Promise<T> {
  const response = await dedupeFetch(input, init, options);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(bodyText || 'Failed to load resource.');
  }

  try {
    return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
  } catch (error) {
    throw new Error('Failed to parse JSON response.');
  }
}

export async function dedupeApiFetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const cacheTtlMs = getRouteDedupeTtl(input, init);
  return dedupeFetchJson<T>(input, init, cacheTtlMs ? { cacheTtlMs } : undefined);
}
