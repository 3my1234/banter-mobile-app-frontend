import { useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { useAppThemeColors } from "@/components/theme";

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const themeColors = useAppThemeColors();
  const containerStyle = useMemo(
    () => ({ backgroundColor: themeColors.background }),
    [themeColors]
  );

  useEffect(() => {
    const run = async () => {
      const session = await SecureStore.getItemAsync("banter_session");
      const pending = await SecureStore.getItemAsync(
        "banter_pending_registration"
      );
      if (session) {
        router.replace("/(tabs)");
      } else if (pending) {
        router.replace("/(auth)/register");
      } else {
        router.replace("/(auth)/login");
      }
      setChecking(false);
    };
    run();
  }, [router]);

  if (!checking) {
    return null;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        ...containerStyle,
      }}
    >
      <ActivityIndicator />
    </View>
  );
}
