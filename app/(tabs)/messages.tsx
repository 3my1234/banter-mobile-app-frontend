import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import { setMessageUnreadCount } from "@/lib/messageBadge";

type InboxItem = {
  id: string;
  conversationId: string;
  senderName?: string;
  preview?: string;
  createdAt?: string;
  unread?: boolean;
  unreadCount?: number;
  status?: "PENDING" | "ACTIVE" | "REJECTED";
  pendingIncoming?: boolean;
  pendingOutgoing?: boolean;
  participant?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
  } | null;
};

export default function MessagesScreen() {
  const router = useRouter();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [messages, setMessages] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch("/messages?limit=50");
      const items = Array.isArray(response?.messages) ? response.messages : [];
      setMessages(items);
      setMessageUnreadCount(Number(response?.unreadCount || 0));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
    }, [loadMessages])
  );

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadMessages();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <CenteredHeartbeatLoader
          visible={loading || refreshing}
          text={loading ? "Loading messages..." : "Refreshing..."}
        />
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtle}>
          New chats require approval the first time someone messages you.
        </Text>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={["transparent"]}
              progressBackgroundColor="transparent"
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
          renderItem={({ item }) => {
            const pendingLabel = item.pendingIncoming
              ? "Pending your approval"
              : item.pendingOutgoing
                ? "Awaiting approval"
                : null;
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/messages/[conversationId]",
                    params: { conversationId: item.conversationId },
                  })
                }
                style={styles.row}
              >
                <View style={styles.dotWrap}>
                  {item.unread ? <View style={styles.unreadDot} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowHead}>
                    <Text style={styles.sender}>
                      {item.participant?.displayName ||
                        item.participant?.username ||
                        item.senderName ||
                        "User"}
                    </Text>
                    {pendingLabel ? <Text style={styles.pending}>{pendingLabel}</Text> : null}
                  </View>
                  <Text style={styles.preview} numberOfLines={2}>
                    {item.preview || "Open conversation"}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: "700" },
    subtle: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
    empty: { color: colors.textMuted, marginTop: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      gap: 8,
    },
    rowHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    dotWrap: { width: 14, alignItems: "center" },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#ff6b35" },
    sender: { color: colors.text, fontSize: 14, fontWeight: "700", flex: 1 },
    pending: {
      color: "#ff6b35",
      fontSize: 11,
      fontWeight: "700",
    },
    preview: { color: colors.textMuted, marginTop: 2, fontSize: 12 },
  });
