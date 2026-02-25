import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { sendUsdcPayment } from "@/lib/solanaPayment";
import { sendMovementUsdcPayment } from "@/lib/movementPayment";
import { usePrivy } from "@privy-io/expo";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

type Bundle = {
  id: string;
  votes: number;
  price: number;
  currency: string;
};

type PaymentMethod = "SOLANA" | "MOVEMENT" | "CARD";

export default function Votes() {
  const { user } = usePrivy();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const bundleData = await apiFetch("/payments/votes/bundles");
        setBundles(bundleData?.bundles || []);

        const me = await apiFetch("/auth/me");
        setBalance(me?.user?.voteBalance ?? 0);
      } catch {
        // Keep defaults
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const refreshBalance = async () => {
    const me = await apiFetch("/auth/me");
    setBalance(me?.user?.voteBalance ?? 0);
  };

  const handleBuySolana = async (bundleId: string) => {
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
        await refreshBalance();
      }
    } catch (error) {
      Alert.alert("Payment failed", (error as Error)?.message ?? "Try again.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleMovement = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const created = await apiFetch("/payments/movement/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId }),
      });

      let txHash: string;
      const accounts =
        (user as any)?.linkedAccounts || (user as any)?.linked_accounts || [];
      const movementWallet =
        accounts.find(
          (acct: any) =>
            acct?.type === "wallet" &&
            (acct?.chainType === "aptos" || acct?.chain_type === "aptos")
        ) || null;

      if (movementWallet?.signAndSubmitTransaction && movementWallet?.address) {
        const config = new AptosConfig({
          network: Network.CUSTOM,
          fullnode:
            process.env.EXPO_PUBLIC_MOVEMENT_RPC_URL ??
            "https://testnet.movementnetwork.xyz/v1",
        });
        const aptos = new Aptos(config);
        const transaction = await aptos.transaction.build.simple({
          sender: movementWallet.address,
          data: {
            function: "0x1::primary_fungible_store::transfer",
            typeArguments: ["0x1::fungible_asset::Metadata"],
            functionArguments: [created.tokenAddress, created.toAddress, created.amountRaw],
          },
        });
        const result = await movementWallet.signAndSubmitTransaction(transaction);
        txHash = result?.hash || result?.transactionHash || result;
      } else {
        txHash = await sendMovementUsdcPayment({
          toAddress: created.toAddress,
          tokenAddress: created.tokenAddress,
          amountRaw: created.amountRaw,
        });
      }

      const verified = await apiFetch("/payments/movement/votes/verify", {
        method: "POST",
        body: JSON.stringify({ paymentId: created.paymentId, txHash }),
      });

      if (verified?.payment?.status === "COMPLETED") {
        await refreshBalance();
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
      console.log("FW create response:", created);

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

      if (!transactionId && !txRef) {
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
        await refreshBalance();
      }
    } catch (error) {
      console.log("FW error:", error);
      Alert.alert("Payment failed", (error as Error)?.message ?? "Try again.");
    } finally {
      setProcessingId(null);
    }
  };

  const handlePay = async () => {
    if (!selectedBundleId) {
      Alert.alert("Choose votes", "Please select a vote amount.");
      return;
    }
    if (!selectedMethod) {
      Alert.alert("Choose method", "Please select a payment method.");
      return;
    }

    if (selectedMethod === "SOLANA") {
      await handleBuySolana(selectedBundleId);
      return;
    }

    if (selectedMethod === "MOVEMENT") {
      await handleMovement(selectedBundleId);
      return;
    }

    await handleFlutterwave(selectedBundleId);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Votes</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Your vote balance</Text>
          <Text style={styles.balanceValue}>
            {loading ? "â€¦" : balance}
          </Text>
        </View>

        <Text style={styles.section}>Buy votes (1 vote = $1)</Text>
        <Text style={styles.muted}>Select amount</Text>
        <View style={styles.choiceRow}>
          {bundles.map((b) => {
            const isSelected = selectedBundleId === b.id;
            return (
              <TouchableOpacity
                key={b.id}
                style={[styles.choiceChip, isSelected && styles.choiceChipActive]}
                onPress={() => setSelectedBundleId(b.id)}
              >
                <Text style={[styles.choiceText, isSelected && styles.choiceTextActive]}>
                  {b.votes}
                </Text>
                <Text style={[styles.choiceSub, isSelected && styles.choiceTextActive]}>
                  ${b.price.toFixed(0)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.muted}>Payment method</Text>
        <View style={styles.methodRow}>
          <TouchableOpacity
            style={[
              styles.methodChip,
              selectedMethod === "SOLANA" && styles.methodChipActive,
            ]}
            onPress={() => setSelectedMethod("SOLANA")}
          >
            <Text
              style={[
                styles.methodText,
                selectedMethod === "SOLANA" && styles.methodTextActive,
              ]}
            >
              USDC (Solana)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.methodChip,
              selectedMethod === "MOVEMENT" && styles.methodChipActive,
            ]}
            onPress={() => setSelectedMethod("MOVEMENT")}
          >
            <Text
              style={[
                styles.methodText,
                selectedMethod === "MOVEMENT" && styles.methodTextActive,
              ]}
            >
              USDC.e (Movement)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.methodChip,
              selectedMethod === "CARD" && styles.methodChipActive,
            ]}
            onPress={() => setSelectedMethod("CARD")}
          >
            <Text
              style={[
                styles.methodText,
                selectedMethod === "CARD" && styles.methodTextActive,
              ]}
            >
              Card (USD)
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.payBtn,
            (processingId || !selectedBundleId || !selectedMethod) &&
              styles.payBtnDisabled,
          ]}
          onPress={handlePay}
          disabled={!!processingId || !selectedBundleId || !selectedMethod}
        >
          <Text style={styles.payText}>
            {processingId ? "Processing..." : "Pay"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 16, gap: 12 },
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
  muted: { color: "#888", fontSize: 12 },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#111",
    minWidth: 72,
    alignItems: "center",
  },
  choiceChipActive: {
    borderColor: "#ff6b35",
    backgroundColor: "rgba(255,107,53,0.12)",
  },
  choiceText: { color: "#fafafa", fontWeight: "700", fontSize: 14 },
  choiceSub: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  choiceTextActive: { color: "#ff6b35" },
  methodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  methodChip: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#111",
  },
  methodChipActive: {
    borderColor: "#ff6b35",
    backgroundColor: "rgba(255,107,53,0.12)",
  },
  methodText: { color: "#fafafa", fontWeight: "700", fontSize: 12 },
  methodTextActive: { color: "#ff6b35" },
  payBtn: {
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  payBtnDisabled: { opacity: 0.6 },
  payText: { color: "#0d0d0d", fontWeight: "700", fontSize: 16 },
});
