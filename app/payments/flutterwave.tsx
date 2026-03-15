import { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

export default function FlutterwaveRedirectScreen() {
  const router = useRouter();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  useEffect(() => {
    router.replace("/(tabs)/votes");
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
