import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, View, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { sendUsdcPayment } from "@/lib/solanaPayment";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

type Bundle = {
  id: string;
  votes: number;
  price: number;
  currency: string;
};

export default function Votes() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const bundleData = await apiFetch("/payments/votes/bundles", {}, false);
        setBundles(bundleData?.bundles || []);

        const me = await apiFetch("/auth/me");
        setBalance(me?.user?.voteBalance ?? 0);
      } catch (error) {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleBuy = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const created = await apiFetch("/payments/solana/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId }),
      });

      const txHash = await sendUsdcPayment({
        toAddress: created.toAddress,
        tokenMint: created.tokenMint,
        amountRaw: created.amountRaw,
        decimals: created.decimals ?? 6,
      });

      const verified = await apiFetch("/payments/solana/votes/verify", {
        method: "POST",
        body: JSON.stringify({ paymentId: created.paymentId, txHash }),
      });

      if (verified?.payment?.status === "COMPLETED") {
        const me = await apiFetch("/auth/me");
        setBalance(me?.user?.voteBalance ?? 0);
      }
    } catch (error) {
      Alert.alert("Payment failed", (error as Error)?.message ?? "Try again.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleFlutterwave = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const redirectUrl = Linking.createURL("payments/flutterwave");
      const created = await apiFetch("/payments/flutterwave/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId, redirectUrl }),
      });

      const result = await WebBrowser.openAuthSessionAsync(
        created.paymentUrl,
        redirectUrl
      );

      if (result.type !== "success" || !result.url) {
        throw new Error("Payment was cancelled.");
      }

      const parsed = Linking.parse(result.url);
      const transactionId =
        parsed.queryParams?.transaction_id || parsed.queryParams?.transactionId;
      const txRef = parsed.queryParams?.tx_ref || parsed.queryParams?.txRef;

      if (!transactionId) {
        throw new Error("Payment did not return a transaction id.");
      }

      const verified = await apiFetch("/payments/flutterwave/votes/verify", {
        method: "POST",
        body: JSON.stringify({
          paymentId: created.paymentId,
          transactionId,
          txRef,
        }),
      });

      if (verified?.payment?.status === "COMPLETED") {
        const me = await apiFetch("/auth/me");
        setBalance(me?.user?.voteBalance ?? 0);
      }
    } catch (error) {
      Alert.alert("Payment failed", (error as Error)?.message ?? "Try again.");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.title}>Votes</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Your vote balance</Text>
          <Text style={styles.balanceValue}>
            {loading ? "…" : balance}
          </Text>
        </View>

        <Text style={styles.section}>Buy bundles</Text>
        {bundles.map((b) => (
          <View key={b.id} style={styles.bundle}>
            <Text style={styles.bundleLabel}>{b.votes} votes</Text>
            <Text style={styles.bundlePrice}>
              ${b.price.toFixed(2)} {b.currency}
            </Text>
            <View style={styles.bundleActions}>
              <TouchableOpacity
                style={[
                  styles.buyBtn,
                  processingId === b.id && styles.buyBtnDisabled,
                ]}
                disabled={processingId === b.id}
                onPress={() => handleBuy(b.id)}
              >
                <Text style={styles.buyText}>USDC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.buyBtnAlt,
                  processingId === b.id && styles.buyBtnDisabled,
                ]}
                disabled={processingId === b.id}
                onPress={() => handleFlutterwave(b.id)}
              >
                <Text style={styles.buyTextAlt}>Card</Text>
              </TouchableOpacity>
            </View>
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
  bundleActions: { flexDirection: "row", gap: 8 },
  buyBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buyBtnAlt: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buyBtnDisabled: {
    opacity: 0.6,
  },
  buyText: { color: "#0d0d0d", fontWeight: "700" },
  buyTextAlt: { color: "#fafafa", fontWeight: "700" },
});
