import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import { setMessageUnreadCount } from "@/lib/messageBadge";

type ConversationMessage = {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
};

type ConversationPayload = {
  id: string;
  status: "PENDING" | "ACTIVE" | "REJECTED";
  pendingIncoming: boolean;
  pendingOutgoing: boolean;
  participant?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
  } | null;
  messages: ConversationMessage[];
};

export default function ConversationScreen() {
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [body, setBody] = useState("");
  const [conversation, setConversation] = useState<ConversationPayload | null>(null);

  const loadConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      setLoading(true);
      const response = await apiFetch(`/messages/conversations/${conversationId}`);
      const nextConversation = response?.conversation || null;
      setConversation(nextConversation);
      try {
        const unreadResponse = await apiFetch("/messages/unread-count");
        setMessageUnreadCount(Number(unreadResponse?.unreadCount || 0));
      } catch {
        // keep last unread count
      }
    } catch (error) {
      Alert.alert("Messages", (error as Error)?.message || "Failed to load conversation.");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [conversationId, router]);

  useEffect(() => {
    loadConversation();
  }, [loadConversation]);

  const handleAction = async (action: "accept" | "reject") => {
    if (!conversationId) return;
    try {
      setActing(true);
      await apiFetch(`/messages/conversations/${conversationId}/${action}`, { method: "POST" });
      if (action === "reject") {
        setMessageUnreadCount(0);
      }
      await loadConversation();
    } catch (error) {
      Alert.alert("Messages", (error as Error)?.message || `Failed to ${action} request.`);
    } finally {
      setActing(false);
    }
  };

  const sendMessage = async () => {
    if (!conversationId || !body.trim()) return;
    try {
      setSending(true);
      const response = await apiFetch(`/messages/conversations/${conversationId}/send`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      });
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              status: "ACTIVE",
              messages: [...prev.messages, response.message],
            }
          : prev
      );
      setBody("");
    } catch (error) {
      Alert.alert("Messages", (error as Error)?.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()}>
              <Text style={styles.back}>Back</Text>
            </Pressable>
            <Text style={styles.title}>
              {conversation?.participant?.displayName ||
                conversation?.participant?.username ||
                "Messages"}
            </Text>
            <View style={{ width: 32 }} />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <>
              {conversation?.pendingIncoming ? (
                <View style={styles.requestCard}>
                  <Text style={styles.requestTitle}>Message request</Text>
                  <Text style={styles.requestText}>
                    Accept to let this user send you messages directly.
                  </Text>
                  <View style={styles.requestActions}>
                    <Pressable
                      style={[styles.secondaryButton, acting && styles.buttonDisabled]}
                      onPress={() => handleAction("reject")}
                    >
                      <Text style={styles.secondaryButtonText}>Reject</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryButton, acting && styles.buttonDisabled]}
                      onPress={() => handleAction("accept")}
                    >
                      <Text style={styles.primaryButtonText}>
                        {acting ? "Working..." : "Accept"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {conversation?.pendingOutgoing ? (
                <View style={styles.requestCard}>
                  <Text style={styles.requestTitle}>Awaiting approval</Text>
                  <Text style={styles.requestText}>
                    The other user needs to accept before this conversation becomes active.
                  </Text>
                </View>
              ) : null}

              <FlatList
                data={conversation?.messages || []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleOther]}>
                    <Text style={[styles.bubbleText, item.mine && styles.bubbleTextMine]}>{item.body}</Text>
                  </View>
                )}
              />

              {conversation?.status === "ACTIVE" ? (
                <View style={styles.composeRow}>
                  <TextInput
                    value={body}
                    onChangeText={setBody}
                    placeholder="Write a message"
                    placeholderTextColor={themeColors.textMuted}
                    style={styles.input}
                  />
                  <Pressable
                    style={[styles.primaryButton, sending && styles.buttonDisabled]}
                    onPress={sendMessage}
                  >
                    <Text style={styles.primaryButtonText}>{sending ? "..." : "Send"}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    back: { color: "#ff6b35", fontSize: 13, fontWeight: "700" },
    title: { color: colors.text, fontSize: 18, fontWeight: "700" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    requestCard: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    requestTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
    requestText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
    requestActions: { flexDirection: "row", gap: 10 },
    primaryButton: {
      backgroundColor: "#ff6b35",
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: { color: "#0d0d0d", fontWeight: "700" },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceAlt,
    },
    secondaryButtonText: { color: colors.text, fontWeight: "700" },
    buttonDisabled: { opacity: 0.6 },
    listContent: { gap: 8, paddingBottom: 8 },
    bubble: {
      maxWidth: "82%",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
    },
    bubbleMine: {
      alignSelf: "flex-end",
      backgroundColor: "#ff6b35",
    },
    bubbleOther: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bubbleText: { color: colors.text, fontSize: 13, lineHeight: 18 },
    bubbleTextMine: { color: "#0d0d0d" },
    composeRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      backgroundColor: colors.surface,
    },
  });
