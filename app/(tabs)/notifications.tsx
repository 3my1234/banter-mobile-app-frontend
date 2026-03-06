import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import {
  setNotificationUnreadCount,
} from "@/lib/notificationBadge";
import { getSocket } from "@/lib/socket";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: any;
  readAt?: string | null;
  createdAt: string;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatRelativeTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const asTrimmed = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const looksLikeJson = (value: string) => value.startsWith("{") && value.endsWith("}");

const formatRawAmount = (raw: string, decimals: number) => {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;
  return (numeric / 10 ** Math.max(0, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(Math.max(0, decimals), 8),
  });
};

const resolveAmount = (payload: Record<string, any>, tokenSymbol: string) => {
  const display =
    asTrimmed(payload.amountDisplay) ||
    asTrimmed(payload.ammountDisplay) ||
    asTrimmed(payload.amount);
  if (display) return display;

  const raw = asTrimmed(payload.amountRaw) || asTrimmed(payload.ammountRaw);
  if (!raw) return "";
  const decimalsCandidate = Number(payload.decimals ?? payload.tokenDecimals ?? (tokenSymbol === "ROL" ? 8 : 6));
  const decimals = Number.isFinite(decimalsCandidate) ? decimalsCandidate : tokenSymbol === "ROL" ? 8 : 6;
  return formatRawAmount(raw, decimals);
};

const toDisplayTitle = (item: NotificationItem) => {
  if (item.type === "DAILY_POINTS") return "Daily Banter Points Added";
  if (item.type === "DAILY_ROL") return "Legacy Daily Reward";
  if (item.type === "WALLET_RECEIVE") return "Wallet Credit";
  if (item.type === "WALLET_TRANSFER") return "Wallet Transfer";
  if (item.type === "VOTE_PURCHASE") return "Vote Purchase";

  const title = asTrimmed(item.title);
  if (!title) return "Notification";
  if (/^[A-Z0-9_]+$/.test(title)) {
    return title
      .toLowerCase()
      .split("_")
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
      .join(" ");
  }
  return title;
};

const toDisplayMessage = (item: NotificationItem) => {
  const direct = (item.body || "").trim();
  if (direct && !looksLikeJson(direct)) return direct;

  const payload = (item.data || {}) as Record<string, any>;
  if (item.type === "DAILY_POINTS") {
    return "You received your daily Banter Points reward. Open Profile > Banter Points to see how your points count toward the future airdrop.";
  }
  if (item.type === "DAILY_ROL") {
    return "Legacy reward entry. Daily login rewards now count as Banter Points.";
  }
  if (item.type === "WALLET_RECEIVE") {
    const token = asTrimmed(payload.tokenSymbol) || "TOKEN";
    const amount = resolveAmount(payload, token);
    return amount ? `+${amount} ${token}` : "Wallet received funds.";
  }
  if (item.type === "WALLET_TRANSFER") {
    const token = asTrimmed(payload.tokenSymbol) || "TOKEN";
    const amount = resolveAmount(payload, token);
    return amount ? `-${amount} ${token}` : "Wallet transfer sent.";
  }
  if (item.type === "VOTE_PURCHASE") {
    const votes = Number(payload.votes || 0);
    if (votes > 0) return `You received ${votes} vote${votes === 1 ? "" : "s"}.`;
    return "Vote purchase completed.";
  }
  return item.title || "Notification update";
};

const buildDailyFallbackNotification = (meUser: any): NotificationItem | null => {
  const lastDailyValue = meUser?.lastDailyPointsAt || meUser?.lastDailyRolAt;
  const lastDaily = lastDailyValue ? new Date(lastDailyValue) : null;
  if (!lastDaily || Number.isNaN(lastDaily.getTime())) {
    return null;
  }
  if (!isSameDay(lastDaily, new Date())) {
    return null;
  }
  return {
    id: `local:daily-points:${lastDaily.toISOString().slice(0, 10)}`,
    type: "DAILY_POINTS",
    title: "Daily Banter Points added",
    body: "You received your daily Banter Points reward.",
    createdAt: lastDaily.toISOString(),
    readAt: null,
  };
};

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NotificationItem | null>(null);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.readAt).length,
    [items]
  );

  useEffect(() => {
    setNotificationUnreadCount(unreadCount);
  }, [unreadCount]);

  const loadFallbackDailyRolNotification = useCallback(async () => {
    try {
      const me = await apiFetch("/auth/me");
      const user = me?.user || {};
      const fallback = buildDailyFallbackNotification(user);
      const nextItems = fallback ? [fallback] : [];
      setItems(nextItems);
    } catch {
      setItems([]);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch("/notifications?limit=100");
      const apiItems: NotificationItem[] = Array.isArray(response?.notifications)
        ? response.notifications
        : [];
      try {
        const me = await apiFetch("/auth/me");
        const fallback = buildDailyFallbackNotification(me?.user || {});
        const filteredItems = apiItems.filter((item) => item.type !== "DAILY_ROL");
        const hasDaily = filteredItems.some((item) => item.type === "DAILY_POINTS");
        if (fallback && !hasDaily) {
          const nextItems = [fallback, ...filteredItems];
          setItems(nextItems);
        } else {
          setItems(filteredItems);
        }
      } catch {
        const nextItems = apiItems.filter((item) => item.type !== "DAILY_ROL");
        setItems(nextItems);
      }
    } catch (e: any) {
      const message = String(e?.message || "");
      const endpointMissing =
        message.includes("Cannot GET /api/notifications") || message.includes("Request failed (404)");
      if (endpointMissing) {
        setError(null);
        await loadFallbackDailyRolNotification();
        return;
      }
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [loadFallbackDailyRolNotification]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  useEffect(() => {
    let socket: any;
    let disposed = false;

    const setup = async () => {
      try {
        socket = await getSocket();
        if (disposed || !socket) return;

        socket.emit("notifications.subscribe");

        const onNew = (payload: NotificationItem) => {
          setItems((prev) => {
            const filtered = prev.filter((item) => item.id !== payload.id);
            return [payload, ...filtered];
          });
        };

        const onRead = (payload: { id: string; readAt: string }) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === payload.id ? { ...item, readAt: payload.readAt } : item
            )
          );
        };

        const onReadAll = (payload: { readAt: string }) => {
          setItems((prev) =>
            prev.map((item) =>
              item.readAt ? item : { ...item, readAt: payload.readAt }
            )
          );
        };

        socket.on("notifications.new", onNew);
        socket.on("notifications.read", onRead);
        socket.on("notifications.read_all", onReadAll);
      } catch {
        // Silent fail: list API still works.
      }
    };

    setup();
    return () => {
      disposed = true;
      if (socket) {
        socket.off("notifications.new");
        socket.off("notifications.read");
        socket.off("notifications.read_all");
      }
    };
  }, []);

  const markRead = async (id: string) => {
    if (id.startsWith("local:")) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
      return;
    }
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "POST" });
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
    } catch {
      // Ignore local read errors.
    }
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((item) => (item.readAt ? item : { ...item, readAt: now })));
    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
    } catch {
      // Ignore local read-all errors.
    }
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadNotifications();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <CenteredHeartbeatLoader visible={loading || refreshing} text={loading ? "Loading notifications..." : "Refreshing..."} />
        <View style={styles.header}>
          <Text style={styles.title}>Notifications</Text>
          <Pressable onPress={markAllRead} disabled={unreadCount === 0}>
            <Text style={[styles.markAll, unreadCount === 0 && styles.markAllDisabled]}>
              Mark all read
            </Text>
          </Pressable>
        </View>
        <Text style={styles.subtle}>{unreadCount} unread</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={["transparent"]}
              progressBackgroundColor="transparent"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            !loading ? <Text style={styles.subtle}>No notifications yet.</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.item}
              onPress={() => {
                if (!item.readAt) {
                  void markRead(item.id);
                }
                setSelected(item);
              }}
            >
              <View style={[styles.dot, item.readAt ? styles.dotRead : styles.dotUnread]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{toDisplayTitle(item)}</Text>
                <Text style={styles.text}>{toDisplayMessage(item)}</Text>
              </View>
              <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
            </Pressable>
          )}
        />

        <Modal
          visible={Boolean(selected)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelected(null)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              {selected ? (
                <ScrollView>
                  <Text style={styles.modalTitle}>{toDisplayTitle(selected)}</Text>
                  <Text style={styles.modalMessage}>{toDisplayMessage(selected)}</Text>
                  <Text style={styles.modalMeta}>Created: {formatDateTime(selected.createdAt)}</Text>
                  <Text style={styles.modalMeta}>
                    Status: {selected.readAt ? `Read at ${formatDateTime(selected.readAt)}` : "Unread"}
                  </Text>
                  <Pressable style={styles.closeButton} onPress={() => setSelected(null)}>
                    <Text style={styles.closeButtonText}>Close</Text>
                  </Pressable>
                </ScrollView>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d", paddingHorizontal: 12 },
  header: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#fafafa", fontSize: 18, fontWeight: "700" },
  markAll: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
  markAllDisabled: { opacity: 0.4 },
  subtle: { color: "#888", fontSize: 12, marginTop: 4 },
  error: { color: "#ff6b35", marginTop: 8, fontSize: 12 },
  item: { flexDirection: "row", gap: 10, paddingVertical: 10, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotUnread: { backgroundColor: "#ff6b35" },
  dotRead: { backgroundColor: "#353535" },
  itemTitle: { color: "#fafafa", fontSize: 14, fontWeight: "700" },
  text: { color: "#c8c8c8", fontSize: 13, marginTop: 2 },
  time: { color: "#777", fontSize: 11, marginTop: 2 },
  sep: { height: 1, backgroundColor: "#1d1d1d" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: "#111",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    maxHeight: "80%",
    padding: 14,
  },
  modalTitle: { color: "#fafafa", fontSize: 18, fontWeight: "700" },
  modalMessage: { color: "#d5d5d5", fontSize: 14, marginTop: 10, lineHeight: 20 },
  modalMeta: { color: "#8f8f8f", fontSize: 12, marginTop: 8 },
  closeButton: {
    marginTop: 14,
    backgroundColor: "#ff6b35",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  closeButtonText: { color: "#111", fontWeight: "800", fontSize: 13 },
});
