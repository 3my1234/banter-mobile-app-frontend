import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";

const items = [
  { id: "n1", type: "like", text: "Jude liked your banter", time: "5m" },
  { id: "n2", type: "comment", text: "Pep commented: 'Interesting take!'", time: "12m" },
  { id: "n3", type: "vote", text: "Your roast gained 32 🔥 votes", time: "1h" },
];

export default function Notifications() {
  const renderItem = ({ item }: any) => (
    <View style={styles.item}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.text}>{item.text}</Text>
        <Text style={styles.time}>{item.time}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        contentContainerStyle={{ paddingVertical: 12 }}
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d", paddingHorizontal: 12 },
  item: { flexDirection: "row", gap: 10, paddingVertical: 10, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ff6b35" },
  text: { color: "#fafafa", fontSize: 15 },
  time: { color: "#888", fontSize: 12, marginTop: 2 },
  sep: { height: 1, backgroundColor: "#1d1d1d" },
});
