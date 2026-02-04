import * as SecureStore from "expo-secure-store";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";

export type Session = { token: string; email?: string };

export async function getSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync("banter_session");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  requireAuth: boolean = true
) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");

  if (requireAuth) {
    const session = await getSession();
    if (session?.token) {
      headers.set("Authorization", `Bearer ${session.token}`);
    }
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}) ${text}`);
  }

  return res.json();
}

export { API_BASE_URL };
