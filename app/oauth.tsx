import React, { useEffect, useMemo } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

export default function OAuthRedirectScreen() {
  const router = useRouter();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  useEffect(() => {
    router.replace("/(auth)/login");
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#ff6b35" />
    </View>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
    },
  });
