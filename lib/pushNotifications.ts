import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { apiFetch } from "@/lib/api";

const PUSH_TOKEN_KEY = "banter_expo_push_token";
const PUSH_TOKEN_SYNC_AT_KEY = "banter_expo_push_token_synced_at";
const PUSH_TOKEN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const getProjectId = () =>
  Constants.expoConfig?.extra?.eas?.projectId ||
  Constants.easConfig?.projectId ||
  "";

const shouldSkipSync = async (token: string) => {
  const [savedToken, savedAtRaw] = await Promise.all([
    SecureStore.getItemAsync(PUSH_TOKEN_KEY),
    SecureStore.getItemAsync(PUSH_TOKEN_SYNC_AT_KEY),
  ]);
  if (!savedToken || savedToken !== token) return false;
  const savedAt = Number(savedAtRaw || 0);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return false;
  return Date.now() - savedAt < PUSH_TOKEN_SYNC_INTERVAL_MS;
};

export const registerDevicePushToken = async () => {
  if (Platform.OS === "web") return;

  const projectId = getProjectId();
  if (!projectId) return;

  const permission = await Notifications.getPermissionsAsync();
  let status = permission.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return;

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse.data?.trim();
  if (!token) return;

  if (await shouldSkipSync(token)) return;

  await apiFetch("/notifications/push-token", {
    method: "POST",
    body: JSON.stringify({
      token,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version || "",
    }),
  });

  await Promise.all([
    SecureStore.setItemAsync(PUSH_TOKEN_KEY, token),
    SecureStore.setItemAsync(PUSH_TOKEN_SYNC_AT_KEY, String(Date.now())),
  ]);
};

export const unregisterDevicePushToken = async () => {
  if (Platform.OS === "web") return;

  const token = ((await SecureStore.getItemAsync(PUSH_TOKEN_KEY)) || "").trim();
  if (!token) return;

  try {
    await apiFetch("/notifications/push-token", {
      method: "DELETE",
      body: JSON.stringify({ token }),
    });
  } finally {
    await Promise.all([
      SecureStore.deleteItemAsync(PUSH_TOKEN_KEY),
      SecureStore.deleteItemAsync(PUSH_TOKEN_SYNC_AT_KEY),
    ]);
  }
};
