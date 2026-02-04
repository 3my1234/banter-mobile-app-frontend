import React from "react";
import { StyleSheet, View, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";

const bundles = [
  { id: "b1", label: "10 votes", price: "$1.99" },
  { id: "b2", label: "100 votes", price: "$14.99" },
  { id: "b3", label: "1000 votes", price: "$99.99" },
];

export default function Votes() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.title}>Votes</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Your vote balance</Text>
          <Text style={styles.balanceValue}>-</Text>
        </View>

        <Text style={styles.section}>Buy bundles</Text>
        {bundles.map((b) => (
          <View key={b.id} style={styles.bundle}>
            <Text style={styles.bundleLabel}>{b.label}</Text>
            <Text style={styles.bundlePrice}>{b.price}</Text>
            <TouchableOpacity style={styles.buyBtn}>
              <Text style={styles.buyText}>Buy</Text>
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
  balanceCard: {
    backgroundColor: "#1a1a1a",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  balanceLabel: { color: "#888" },
  balanceValue: { color: "#fafafa", fontSize: 24, fontWeight: "700" },
  section: { color: "#fafafa", fontSize: 16, fontWeight: "700", marginTop: 8 },
  bundle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  bundleLabel: { color: "#fafafa", fontWeight: "700" },
  bundlePrice: { color: "#888" },
  buyBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buyText: { color: "#0d0d0d", fontWeight: "700" },
});
