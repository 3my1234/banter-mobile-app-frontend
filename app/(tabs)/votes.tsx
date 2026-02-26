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
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { usePrivy } from "@privy-io/expo";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useCreateWallet, useSignRawHash } from "@privy-io/expo/extended-chains";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { getMovementWallet, sendMovementTransaction } from "@/lib/privyMovement";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "@/lib/api";
import { Buffer } from "buffer";

type Bundle = {
  id: string;
  votes: number;
  price: number;
  currency: string;
};

type PaymentMethod = "SOLANA" | "MOVEMENT" | "CARD";

export default function Votes() {
  const { user, getAccessToken } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
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

  const syncPrivySessionToBackend = async () => {
    const privyToken = await getAccessToken();
    if (!privyToken) {
      throw new Error("Privy token not available. Please log in again.");
    }

    const res = await fetch(`${API_BASE_URL}/auth/privy/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privyToken }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to sync Movement wallet: ${text}`);
    }

    const verified = await res.json();
    await SecureStore.setItemAsync(
      "banter_session",
      JSON.stringify({
        token: verified?.token,
        email: verified?.user?.email || "",
      })
    );
    return verified;
  };

  const pollFlutterwaveStatus = async (paymentId: string, attempts: number = 15) => {
    for (let i = 0; i < attempts; i += 1) {
      const statusData = await apiFetch(`/payments/flutterwave/votes/status/${paymentId}`);
      const status = statusData?.payment?.status;
      if (status === "COMPLETED") {
        return "COMPLETED";
      }
      if (status === "FAILED") {
        return "FAILED";
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return "PENDING";
  };

  const handleBuySolana = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const created = await apiFetch("/payments/solana/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId }),
      });

      let wallet = solanaWallet.wallets?.[0];
      if (!wallet) {
        await solanaWallet.create({ recoveryMethod: "privy" });
        wallet = solanaWallet.wallets?.[0];
      }

      if (!wallet?.address) {
        throw new Error("Solana wallet not available. Please log in again.");
      }

      const provider = await wallet.getProvider();
      const connection = new Connection(
        process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
        "confirmed"
      );

      const mint = new PublicKey(created.tokenMint);
      const from = new PublicKey(wallet.address);
      const to = new PublicKey(created.toAddress);
      const fromAta = await getAssociatedTokenAddress(mint, from);
      const toAta = await getAssociatedTokenAddress(mint, to);

      const instructions = [];
      const toAtaInfo = await connection.getAccountInfo(toAta);
      if (!toAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(from, toAta, to, mint)
        );
      }

      const amount = BigInt(created.amountRaw);
      instructions.push(
        createTransferCheckedInstruction(
          fromAta,
          mint,
          toAta,
          from,
          amount,
          created.decimals ?? 6
        )
      );

      const latest = await connection.getLatestBlockhash("finalized");
      const tx = new Transaction();
      tx.feePayer = from;
      tx.recentBlockhash = latest.blockhash;
      instructions.forEach((ix) => tx.add(ix));

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const encoded = Buffer.from(serialized).toString("base64");
      const signResult = await (provider as any).request({
        method: "signAndSendTransaction",
        params: { transaction: encoded },
      });
      const txHash =
        signResult?.signature || signResult?.result || signResult;

      await connection.confirmTransaction(
        { signature: txHash, ...latest },
        "confirmed"
      );

      const verified = await apiFetch("/payments/solana/votes/verify", {
        method: "POST",
        body: JSON.stringify({ paymentId: created.paymentId, txHash }),
      });

      if (verified?.payment?.status === "COMPLETED") {
        await refreshBalance();
      }
    } catch (error) {
      const rawMessage = (error as Error)?.message ?? "Try again.";
      const lowered = rawMessage.toLowerCase();
      const isMovementAccountMissing =
        lowered.includes("account_not_found") ||
        lowered.includes("account not found by address") ||
        lowered.includes("movement account not initialized on-chain");

      if (isMovementAccountMissing) {
        Alert.alert(
          "Payment failed",
          "This Movement wallet is not initialized on-chain yet. Fund this exact wallet with a small amount of MOVE on Movement testnet, wait 1-2 minutes, then try again."
        );
      } else {
        Alert.alert("Payment failed", rawMessage);
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleMovement = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);

      let movementWallet = getMovementWallet(user);
      let createdMovementWallet: any = null;

      if (!movementWallet?.address) {
        try {
          const createdWallet = await createWallet({ chainType: "movement" });
          createdMovementWallet = createdWallet?.wallet;
        } catch (error) {
          const message = ((error as Error)?.message || "").toLowerCase();
          const alreadyExists =
            message.includes("already has an embedded wallet") ||
            message.includes("already has an account of the type linked") ||
            message.includes("already has a wallet");
          if (!alreadyExists) {
            const fallback = await createWallet({ chainType: "aptos" });
            createdMovementWallet = fallback?.wallet;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
        await syncPrivySessionToBackend();
        movementWallet =
          getMovementWallet(user) ||
          (createdMovementWallet
            ? {
                address: createdMovementWallet.address,
                public_key: createdMovementWallet.public_key,
                publicKey: createdMovementWallet.public_key,
              }
            : null);
      }

      if (!movementWallet?.address) {
        throw new Error("Movement wallet not available yet. Please log out and sign in again.");
      }

      const publicKey = movementWallet.publicKey || movementWallet.public_key;
      if (!publicKey) {
        throw new Error("Movement wallet public key not available. Please log in again.");
      }

      const created = await apiFetch("/payments/movement/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId }),
      });

      if (created?.status === "COMPLETED") {
        await refreshBalance();
        return;
      }

      const txHash = await sendMovementTransaction(
        created.transactionData,
        movementWallet.address,
        publicKey,
        signRawHash
      );

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

      let transactionId: string | undefined;
      let txRef: string | undefined = created.reference;

      if (result.type === "success" && result.url) {
        const parsed = Linking.parse(result.url);
        transactionId = (parsed.queryParams?.transaction_id || parsed.queryParams?.transactionId) as
          | string
          | undefined;
        txRef = (parsed.queryParams?.tx_ref || parsed.queryParams?.txRef) as string | undefined;
      } else if (result.type === "cancel" || result.type === "dismiss") {
        // Do not fail immediately; webhooks/callbacks may still complete shortly.
        const finalStatus = await pollFlutterwaveStatus(created.paymentId, 6);
        if (finalStatus === "COMPLETED") {
          await refreshBalance();
          return;
        }
        throw new Error("Payment was cancelled.");
      }

      if (transactionId || txRef) {
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
          return;
        }
      }

      const finalStatus = await pollFlutterwaveStatus(created.paymentId);
      if (finalStatus === "COMPLETED") {
        await refreshBalance();
        return;
      }

      throw new Error("Payment is still pending verification. Please check again shortly.");
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
