import * as SecureStore from "expo-secure-store";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";
const DEBUG_AUTH = process.env.EXPO_PUBLIC_DEBUG_AUTH === "1";
const API_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.EXPO_PUBLIC_API_TIMEOUT_MS || "20000",
  10
);
const API_GET_RETRY_COUNT = Number.parseInt(
  process.env.EXPO_PUBLIC_API_GET_RETRY_COUNT || "1",
  10
);
const API_GET_RETRY_DELAY_MS = Number.parseInt(
  process.env.EXPO_PUBLIC_API_GET_RETRY_DELAY_MS || "400",
  10
);
const GET_CACHE_RULES: Array<{
  prefix: string;
  ttlMs: number;
  when?: (path: string) => boolean;
}> = [
  { prefix: "/auth/me", ttlMs: 1500 },
  { prefix: "/posts?", ttlMs: 6000 },
  {
    prefix: "/wallet/overview",
    ttlMs: 6000,
    when: (path) => !/[?&]refresh=1(?:&|$)/.test(path),
  },
  { prefix: "/notifications?unreadOnly=1", ttlMs: 10_000 },
  { prefix: "/messages/unread-count", ttlMs: 10_000 },
];
const CURRENT_USER_CACHE_TTL_MS = 30_000;
const inFlightRequests = new Map<string, Promise<any>>();
const responseCache = new Map<string, { expiresAt: number; data: any }>();
let currentUserCache:
  | {
      token: string;
      expiresAt: number;
      response: any;
    }
  | null = null;
let currentUserInFlight:
  | {
      token: string;
      promise: Promise<any>;
    }
  | null = null;

export type Session = { token: string; email?: string };

const getGetCacheTtl = (path: string, method: string) => {
  if (method !== "GET") return 0;
  const rule = GET_CACHE_RULES.find(
    (item) => path.startsWith(item.prefix) && (!item.when || item.when(path))
  );
  return rule?.ttlMs ?? 0;
};

const cloneCached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isLikelyRetryableNetworkError = (error: unknown) => {
  const err = error as any;
  const name = String(err?.name || "");
  const message = String(err?.message || "").toLowerCase();
  if (name === "AbortError") return true;
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network request failed") ||
    message.includes("failed to fetch")
  );
};

const isRetryableHttpStatus = (status?: number) =>
  status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export async function getSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync("banter_session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function invalidateCurrentUserCache() {
  currentUserCache = null;
  currentUserInFlight = null;
}

export async function apiFetch(
  path: string,
  options: ApiFetchOptions = {},
  requireAuth: boolean = true
) {
  const { timeoutMs = API_FETCH_TIMEOUT_MS, ...requestOptions } = options;
  const method = (requestOptions.method || "GET").toUpperCase();
  const headers = new Headers(requestOptions.headers || {});
  headers.set("Content-Type", "application/json");
  let authToken = "";

  if (requireAuth) {
    const session = await getSession();
    if (DEBUG_AUTH) {
      console.log("[AUTH DEBUG] JWT from session:", session?.token || "<none>");
    }
    if (!session?.token) {
      throw new Error("Not authenticated");
    }
    authToken = session.token;
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const cacheTtlMs = getGetCacheTtl(path, method);
  const requestKey = cacheTtlMs > 0
    ? `${method}:${path}:${requireAuth ? authToken : "anon"}`
    : null;

  if (requestKey) {
    const cached = responseCache.get(requestKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cloneCached(cached.data);
    }
    const inFlight = inFlightRequests.get(requestKey);
    if (inFlight) {
      return inFlight.then((data) => cloneCached(data));
    }
  }

  const requestPromise = (async () => {
    const maxAttempts = method === "GET" ? API_GET_RETRY_COUNT + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
          ...requestOptions,
          headers,
        }, timeoutMs);

        if (!res.ok) {
          const contentType = res.headers.get("content-type") || "";
          const raw = await res.text().catch(() => "");
          let message = raw;
          if (contentType.includes("application/json")) {
            try {
              const data = JSON.parse(raw);
              const details =
                data?.details ? ` | details: ${JSON.stringify(data.details)}` : "";
              message = (data?.message || data?.error || raw) + details;
            } catch {
              // ignore
            }
          } else {
            try {
              const data = JSON.parse(raw);
              const details =
                data?.details ? ` | details: ${JSON.stringify(data.details)}` : "";
              message = (data?.message || data?.error || raw) + details;
            } catch {
              // ignore
            }
          }
          const statusError = new Error(message || `Request failed (${res.status})`) as Error & {
            status?: number;
          };
          statusError.status = res.status;
          throw statusError;
        }

        const data = await res.json();
        if (requestKey) {
          responseCache.set(requestKey, {
            data,
            expiresAt: Date.now() + cacheTtlMs,
          });
        }
        return data;
      } catch (error: any) {
        lastError = error;
        const retryableHttp = isRetryableHttpStatus(error?.status);
        const retryableNetwork = isLikelyRetryableNetworkError(error);
        const shouldRetry =
          attempt < maxAttempts && method === "GET" && (retryableHttp || retryableNetwork);
        if (!shouldRetry) {
          throw error;
        }
        await sleep(API_GET_RETRY_DELAY_MS * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed");
  })();

  if (!requestKey) {
    return requestPromise;
  }

  inFlightRequests.set(requestKey, requestPromise);
  try {
    const data = await requestPromise;
    return cloneCached(data);
  } finally {
    inFlightRequests.delete(requestKey);
  }
}

export async function getCurrentUser(options?: { force?: boolean }) {
  const session = await getSession();
  if (!session?.token) {
    throw new Error("Not authenticated");
  }

  const force = options?.force === true;
  const now = Date.now();

  if (
    !force &&
    currentUserCache &&
    currentUserCache.token === session.token &&
    currentUserCache.expiresAt > now
  ) {
    return cloneCached(currentUserCache.response);
  }

  if (
    !force &&
    currentUserInFlight &&
    currentUserInFlight.token === session.token
  ) {
    return currentUserInFlight.promise.then((data) => cloneCached(data));
  }

  const promise = apiFetch("/auth/me", undefined, true).then((response) => {
    currentUserCache = {
      token: session.token,
      expiresAt: Date.now() + CURRENT_USER_CACHE_TTL_MS,
      response,
    };
    return response;
  });

  currentUserInFlight = {
    token: session.token,
    promise,
  };

  try {
    const response = await promise;
    return cloneCached(response);
  } finally {
    if (currentUserInFlight?.promise === promise) {
      currentUserInFlight = null;
    }
  }
}

export { API_BASE_URL };
