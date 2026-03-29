import * as SecureStore from "expo-secure-store";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";
const DEBUG_AUTH = process.env.EXPO_PUBLIC_DEBUG_AUTH === "1";
const DEDUPED_GET_PREFIXES = ["/auth/me"];
const SHORT_CACHE_TTL_MS = 1500;
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

const shouldDedupeGet = (path: string, method: string) =>
  method === "GET" && DEDUPED_GET_PREFIXES.some((prefix) => path.startsWith(prefix));

const cloneCached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
  options: RequestInit = {},
  requireAuth: boolean = true
) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
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

  const requestKey = shouldDedupeGet(path, method)
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
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });

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
      throw new Error(message || `Request failed (${res.status})`);
    }

    const data = await res.json();
    if (requestKey) {
      responseCache.set(requestKey, {
        data,
        expiresAt: Date.now() + SHORT_CACHE_TTL_MS,
      });
    }
    return data;
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
