import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

export default function FlutterwaveRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(tabs)/votes");
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#ff6b35" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0d0d0d",
  },
});
