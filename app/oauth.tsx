import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function OAuthRedirectScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(auth)/login");
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
