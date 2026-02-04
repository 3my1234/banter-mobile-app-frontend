import React from "react";
import { StyleSheet, View, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";

const awards = [
  { id: "a1", title: "Ballon d'Or", subtitle: "Vote your winner" },
  { id: "a2", title: "Player of the Week", subtitle: "Top 5 nominees" },
  { id: "a3", title: "Goal of the Week", subtitle: "Watch & vote" },
];

export default function PCA() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.title}>People's Choice Awards</Text>
        {awards.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.cardSub}>{a.subtitle}</Text>
            <TouchableOpacity style={styles.btn}>
              <Text style={styles.btnText}>Vote</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d", padding: 16, gap: 12 },
  title: { color: "#fafafa", fontSize: 22, fontWeight: "700" },
  card: {
    backgroundColor: "#1a1a1a",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  cardTitle: { color: "#fafafa", fontSize: 16, fontWeight: "700" },
  cardSub: { color: "#888" },
  btn: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "#ff6b35",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnText: { color: "#0d0d0d", fontWeight: "700" },
});
