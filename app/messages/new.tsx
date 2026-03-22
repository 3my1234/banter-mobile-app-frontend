import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

export default function NewMessageScreen() {
  const router = useRouter();
  const { recipientId, displayName } = useLocalSearchParams<{
    recipientId?: string;
    displayName?: string;
  }>();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!recipientId) return;
      try {
        setLoading(true);
        const response = await apiFetch(`/messages/with/${recipientId}`);
        if (response?.conversation?.conversationId) {
          router.replace({
            pathname: "/messages/[conversationId]",
            params: { conversationId: String(response.conversation.conversationId) },
          });
        }
      } catch {
        // ignore and allow composing
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [recipientId, router]);

  const sendFirstMessage = async () => {
    if (!recipientId) {
      Alert.alert("Message failed", "Recipient not found.");
      return;
    }
    if (!body.trim()) {
      Alert.alert("Message failed", "Write a message first.");
      return;
    }
    try {
      setSubmitting(true);
      const response = await apiFetch("/messages/start", {
        method: "POST",
        body: JSON.stringify({
          recipientId,
          body: body.trim(),
        }),
      });
      router.replace({
        pathname: "/messages/[conversationId]",
        params: { conversationId: String(response.conversationId) },
      });
    } catch (error) {
      Alert.alert("Message failed", (error as Error)?.message || "Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={16}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>New Message</Text>
          <View style={{ width: 32 }} />
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <Text style={styles.label}>To</Text>
            <Text style={styles.name}>{displayName || "User"}</Text>
            <Text style={styles.helper}>
              Your first message needs approval before the conversation becomes active.
            </Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Write your message"
              placeholderTextColor={themeColors.textMuted}
              multiline
              style={styles.input}
            />
            <Pressable style={[styles.button, submitting && styles.buttonDisabled]} onPress={sendFirstMessage}>
              <Text style={styles.buttonText}>{submitting ? "Sending..." : "Send request"}</Text>
            </Pressable>
          </>
        )}
      </View>
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
    label: { color: colors.textMuted, fontSize: 12 },
    name: { color: colors.text, fontSize: 20, fontWeight: "700" },
    helper: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
    input: {
      minHeight: 140,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      color: colors.text,
      backgroundColor: colors.surface,
      textAlignVertical: "top",
    },
    button: {
      backgroundColor: "#ff6b35",
      borderRadius: 12,
      alignItems: "center",
      paddingVertical: 12,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#0d0d0d", fontWeight: "700", fontSize: 14 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
