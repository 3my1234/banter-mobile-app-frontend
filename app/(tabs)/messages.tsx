import React, { useCallback, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";

type MessageItem = {
  id: string;
  senderName?: string;
  preview?: string;
  createdAt?: string;
  unread?: boolean;
};

export default function MessagesScreen() {
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const loadMessages = useCallback(async () => {
    try {
      // Messaging backend routes are optional in this app version.
      const response = await apiFetch("/messages?limit=50");
      const items = Array.isArray(response?.messages) ? response.messages : [];
      setMessages(items);
    } catch {
      setMessages([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMessages();
    }, [loadMessages])
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.title}>Messages</Text>
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12 }}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: { color: "#fafafa", fontSize: 18, fontWeight: "700" },
  empty: { color: "#9ca3af", marginTop: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
  },
  dotWrap: { width: 14, alignItems: "center" },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#ff6b35" },
  sender: { color: "#fafafa", fontSize: 14, fontWeight: "700" },
  preview: { color: "#9ca3af", marginTop: 2, fontSize: 12 },
});
