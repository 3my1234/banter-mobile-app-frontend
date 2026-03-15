import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

// Point base URL directly at API root (includes /api to avoid double-prefix issues).
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";

type PendingRegistration = {
  email: string;
  solanaAddress: string;
  movementAddress?: string;
  userInfo: any;
};

const RegisterScreen = () => {
  const router = useRouter();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const loadPending = async () => {
      const raw = await SecureStore.getItemAsync("banter_pending_registration");
      if (!raw) {
        router.replace("/(auth)/login");
        return;
      }
      const parsed = JSON.parse(raw) as PendingRegistration;
      setPending(parsed);
      setDisplayName(parsed.userInfo?.name ?? "");
    };
    loadPending();
  }, [router]);

  const registerUser = async () => {
    if (!pending) return;
    if (!username.trim()) {
      setErrorText("Username is required");
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pending.email,
          displayName: displayName.trim(),
          username: username.trim(),
          solanaAddress: pending.solanaAddress,
          ...(pending.movementAddress ? { movementAddress: pending.movementAddress } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Register failed (${res.status})`);
      }
      const data = (await res.json()) as { token: string };
      await SecureStore.setItemAsync(
        "banter_session",
        JSON.stringify({ token: data.token, email: pending.email })
      );
      await SecureStore.deleteItemAsync("banter_pending_registration");
      router.replace("/(tabs)");
    } catch (error) {
      setErrorText((error as Error)?.message ?? "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>
      <TextInput
        style={styles.input}
        placeholder="Display name"
        placeholderTextColor="#999"
        value={displayName}
        onChangeText={setDisplayName}
      />
      <TextInput
        style={styles.input}
        placeholder="Username"
        placeholderTextColor="#999"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      <Button
        title={isSubmitting ? "Creating..." : "Create account"}
        onPress={registerUser}
        disabled={isSubmitting}
      />
    </View>
  );
};

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      marginBottom: 16,
      textAlign: "center",
    },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.borderStrong,
      borderWidth: 1,
      borderRadius: 12,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    errorText: {
      color: "#ff6b35",
      textAlign: "center",
      marginBottom: 8,
    },
  });

export default RegisterScreen;
