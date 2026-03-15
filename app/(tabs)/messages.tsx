import React, { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

type MessageItem = {
  id: string;
  senderName?: string;
  preview?: string;
  createdAt?: string;
  unread?: boolean;
};

export default function MessagesScreen() {
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      // Messaging backend routes are optional in this app version.
      const response = await apiFetch("/messages?limit=50");
      const items = Array.isArray(response?.messages) ? response.messages : [];
      setMessages(items);
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
        <CenteredHeartbeatLoader visible={loading || refreshing} text={loading ? "Loading messages..." : "Refreshing..."} />
        <Text style={styles.title}>Messages</Text>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={["transparent"]}
              progressBackgroundColor="transparent"
            />
          }
          ListEmptyComponent={<Text style={styles.empty}>No messages</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.dotWrap}>
                {item.unread ? <View style={styles.unreadDot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sender}>{item.senderName || "User"}</Text>
                <Text style={styles.preview}>{item.preview || ""}</Text>
              </View>
            </View>
          )}
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
    empty: { color: colors.textMuted, marginTop: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    dotWrap: { width: 14, alignItems: "center" },
    unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#ff6b35" },
    sender: { color: colors.text, fontSize: 14, fontWeight: "700" },
    preview: { color: colors.textMuted, marginTop: 2, fontSize: 12 },
  });
