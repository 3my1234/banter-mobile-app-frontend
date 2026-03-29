import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import { apiFetch, getCurrentUser } from "@/lib/api";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import * as Clipboard from "expo-clipboard";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { sendEmbeddedSolanaUsdc } from "@/lib/privySolana";

type Bundle = {
  id: string;
  votes: number;
  price: number;
  currency: string;
};

type PaymentMethod = "SOLANA" | "CARD";

const EURO_COUNTRIES = new Set([
  "at", "be", "cy", "de", "ee", "es", "fi", "fr", "gr", "hr", "ie", "it", "lt",
  "lu", "lv", "mt", "nl", "pt", "si", "sk",
  "austria", "belgium", "cyprus", "germany", "estonia", "spain", "finland",
  "france", "greece", "croatia", "ireland", "italy", "lithuania", "luxembourg",
  "latvia", "malta", "netherlands", "portugal", "slovenia", "slovakia",
]);

const flutterwaveLogo = require("../../assets/images/flutterwave-logo.png");

export default function Votes() {
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [solanaPayment, setSolanaPayment] = useState<any | null>(null);
  const [solanaTxHash, setSolanaTxHash] = useState("");
  const [solanaVerifying, setSolanaVerifying] = useState(false);
  const [solanaSending, setSolanaSending] = useState(false);
  const [defaultMethodSet, setDefaultMethodSet] = useState(false);
  const [isNigeria, setIsNigeria] = useState(false);
  const [flutterwaveCurrency, setFlutterwaveCurrency] = useState<"NGN" | "USD" | "GBP" | "EUR">("USD");
  const [confirmingFlutterwave, setConfirmingFlutterwave] = useState(false);
  const [successState, setSuccessState] = useState<{
    votes: number;
    method: PaymentMethod;
  } | null>(null);
  const solanaWallet = useEmbeddedSolanaWallet();
  const solanaGuideUrl =
    process.env.EXPO_PUBLIC_SOLANA_USDC_GUIDE_URL ??
    "https://youtu.be/v5TInJgWdFA?si=QN8rJY_blVW6JbfH";

  const isNigeriaUser = (user?: { country?: string | null; phone?: string | null }) => {
    const country = (user?.country || "").trim().toLowerCase();
    if (country === "nigeria" || country === "ng") return true;
    const digits = (user?.phone || "").replace(/\D+/g, "");
    return digits.startsWith("234");
  };

  const getFlutterwaveCurrency = (user?: { country?: string | null; phone?: string | null }) => {
    if (isNigeriaUser(user)) return "NGN" as const;
    const country = (user?.country || "").trim().toLowerCase();
    if (country === "uk" || country === "gb" || country === "united kingdom" || country === "great britain") {
      return "GBP" as const;
    }
    if (EURO_COUNTRIES.has(country)) {
      return "EUR" as const;
    }
    return "USD" as const;
  };

  const loadVotesPage = async () => {
    try {
      setLoading(true);
      const bundleData = await apiFetch("/payments/votes/bundles");
      setBundles(bundleData?.bundles || []);

      const me = await getCurrentUser();
      setBalance(me?.user?.voteBalance ?? 0);
      const nigeria = isNigeriaUser(me?.user || me);
      const currency = getFlutterwaveCurrency(me?.user || me);
      setIsNigeria(nigeria);
      setFlutterwaveCurrency(currency);
      if (!defaultMethodSet) {
        setSelectedMethod(nigeria ? "CARD" : "SOLANA");
        setDefaultMethodSet(true);
      }
    } catch {
      // Keep defaults
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVotesPage();
  }, []);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadVotesPage();
    } finally {
      setRefreshing(false);
    }
  };

  const refreshBalance = async () => {
    const me = await getCurrentUser({ force: true });
    setBalance(me?.user?.voteBalance ?? 0);
  };

  const showPaymentSuccess = (bundleId: string, method: PaymentMethod) => {
    const bundle = bundles.find((b) => b.id === bundleId);
    const votes = bundle?.votes ?? 0;
    setSuccessState({ votes, method });
  };

  const normalizeErrorMessage = (error: unknown) => {
    if (!error) return "Try again.";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message || "Try again.";
    return "Try again.";
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

  const confirmFlutterwaveCompletion = async (paymentId: string, bundleId: string) => {
    setConfirmingFlutterwave(true);
    try {
      const finalStatus = await pollFlutterwaveStatus(paymentId, 30);
      if (finalStatus === "COMPLETED") {
        await refreshBalance();
        showPaymentSuccess(bundleId, "CARD");
        return true;
      }
      if (finalStatus === "FAILED") {
        throw new Error("Payment failed.");
      }
      return false;
    } finally {
      setConfirmingFlutterwave(false);
    }
  };

  const handleBuySolana = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const created = await apiFetch("/payments/solana/votes/create", {
        method: "POST",
        body: JSON.stringify({ bundleId }),
      });
      setSolanaPayment({ ...created, bundleId });
      setSolanaTxHash("");
      return;
    } catch (error) {
      const rawMessage = (error as Error)?.message ?? "Try again.";
      Alert.alert("Payment failed", rawMessage);
    } finally {
      setProcessingId(null);
    }
  };

  const verifySolanaVotePayment = async (txHashOverride?: string) => {
    const hash = (txHashOverride || solanaTxHash).trim();
    if (!solanaPayment?.paymentId || !hash) {
      Alert.alert("Verify payment", "Paste the Solana transaction hash first.");
      return;
    }
    try {
      setSolanaVerifying(true);
      const verified = await apiFetch("/payments/solana/votes/verify", {
        method: "POST",
        body: JSON.stringify({
          paymentId: solanaPayment.paymentId,
          txHash: hash,
        }),
      });
      if (verified?.payment?.status !== "COMPLETED") {
        throw new Error("Payment is still pending. Please try again shortly.");
      }
      setSolanaPayment(null);
      setSolanaTxHash("");
      await refreshBalance();
      showPaymentSuccess(String(solanaPayment.bundleId || ""), "SOLANA");
    } catch (error) {
      Alert.alert("Payment failed", (error as Error)?.message ?? "Try again.");
    } finally {
      setSolanaVerifying(false);
    }
  };

  const handleEmbeddedSolanaVotePayment = async () => {
    if (!solanaPayment?.toAddress || !solanaPayment?.tokenMint) {
      Alert.alert("Payment not ready", "Generate a Solana payment first.");
      return;
    }
    try {
      setSolanaSending(true);
      const result = await sendEmbeddedSolanaUsdc({
        walletState: solanaWallet,
        toAddress: solanaPayment.toAddress,
        amount: Number(solanaPayment.amount || 0),
        tokenMint: solanaPayment.tokenMint,
        decimals: solanaPayment.decimals ?? 6,
        memo: solanaPayment.memo,
      });
      if (result?.signature) {
        setSolanaTxHash(result.signature);
        await verifySolanaVotePayment(result.signature);
      }
    } catch (error) {
      Alert.alert(
        "Payment failed",
        (error as Error)?.message || "Unable to send from the in-app wallet."
      );
    } finally {
      setSolanaSending(false);
    }
  };

  const handleFlutterwave = async (bundleId: string) => {
    try {
      setProcessingId(bundleId);
      const redirectUrl = Linking.createURL("payments/flutterwave");
      const created = await apiFetch("/payments/flutterwave/votes/create", {
        method: "POST",
          body: JSON.stringify({
            bundleId,
            redirectUrl,
            currency: flutterwaveCurrency,
          }),
        });
      if (__DEV__) {
        console.log("FW create response:", created);
      }

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
        const confirmed = await confirmFlutterwaveCompletion(created.paymentId, bundleId);
        if (confirmed) {
          return;
        }
        throw new Error(
          "Checkout was closed before confirmation. If your card was debited, wait a moment and refresh this screen."
        );
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
          showPaymentSuccess(bundleId, "CARD");
          return;
        }
      }

      const confirmed = await confirmFlutterwaveCompletion(created.paymentId, bundleId);
      if (confirmed) {
        return;
      }

      throw new Error("Payment is still being confirmed. If you were charged, refresh this screen shortly.");
    } catch (error) {
      if (__DEV__) {
        console.log("FW error:", error);
      }
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

    await handleFlutterwave(selectedBundleId);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <CenteredHeartbeatLoader visible={loading || refreshing} text={loading ? "Loading votes..." : "Refreshing..."} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressBackgroundColor="transparent"
          />
        }
      >
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
              selectedMethod === "CARD" && styles.methodChipActive,
            ]}
            onPress={() => setSelectedMethod("CARD")}
          >
            <View style={styles.flutterwaveChip}>
              <Image source={flutterwaveLogo} style={styles.flutterwaveLogo} resizeMode="contain" />
            </View>
          </TouchableOpacity>
        </View>
        {selectedMethod === "CARD" ? (
          <Text style={styles.cardNote}>
            {isNigeria
              ? "Charges are in NGN. Bank transfer, USSD, or card can be used. If Flutterwave fails, try USDC (Solana)."
              : `Flutterwave will charge in ${flutterwaveCurrency}. If your bank declines the payment, try USDC (Solana).`}
          </Text>
        ) : null}

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

        <View style={styles.guideCard}>
          <Text style={styles.section}>Wallet payment guide</Text>
          <Text style={styles.guideLabel}>USDC (Solana)</Text>
          <Text style={styles.guideStep}>1. Tap Pay to generate the Solana deposit address.</Text>
          <Text style={styles.guideStep}>2. Withdraw USDC on the Solana (SPL) network.</Text>
          <Text style={styles.guideStep}>3. Paste the transaction hash and tap Verify.</Text>
          {solanaGuideUrl ? (
            <Pressable onPress={() => Linking.openURL(solanaGuideUrl)}>
              <Text style={styles.guideLink}>Watch the USDC (Solana) payment guide</Text>
            </Pressable>
          ) : (
            <Text style={styles.guideStep}>
              Add a guide link in `EXPO_PUBLIC_SOLANA_USDC_GUIDE_URL`.
            </Text>
          )}

          <Text style={styles.guideLabel}>Buy USDC safely via Bybit P2P</Text>
          <Text style={styles.guideStep}>1. Open Bybit → Buy Crypto → P2P Trading → set to Buy.</Text>
          <Text style={styles.guideStep}>2. Select Asset = USDC. If liquidity is low, buy USDT then swap to USDC.</Text>
          <Text style={styles.guideStep}>3. Set Currency = NGN.</Text>
          <Text style={styles.guideStep}>4. Filter: Verified advertisers, Online only, 500+ orders, 99–100% completion.</Text>
          <Text style={styles.guideStep}>5. Enter your NGN amount and tap Buy.</Text>
          <Text style={styles.guideStep}>6. Transfer to the seller’s bank, then tap “Payment completed”.</Text>
          <Text style={styles.guideStep}>7. Wait for release (usually under 5 minutes). USDC arrives in Funding Account.</Text>
        </View>
      </ScrollView>

      {solanaPayment ? (
        <Modal transparent animationType="fade" visible>
          <Pressable style={styles.modalBackdrop} onPress={() => setSolanaPayment(null)} />
          <View style={styles.solanaSheet}>
            <Text style={styles.section}>Send USDC (Solana)</Text>
            <Text style={styles.metaSub}>
              Send exactly {solanaPayment.amount} USDC to:
            </Text>
            <Pressable
              style={styles.copyRow}
              onPress={async () => {
                if (solanaPayment.toAddress) {
                  await Clipboard.setStringAsync(solanaPayment.toAddress);
                  Alert.alert("Copied", "Solana address copied.");
                }
              }}
            >
              <Text style={styles.copyText} numberOfLines={1}>
                {solanaPayment.toAddress}
              </Text>
              <Text style={styles.copyCta}>Copy</Text>
            </Pressable>
            {solanaPayment.memo ? (
              <Pressable
                style={styles.copyRow}
                onPress={async () => {
                  await Clipboard.setStringAsync(String(solanaPayment.memo));
                  Alert.alert("Copied", "Memo code copied.");
                }}
              >
                <Text style={styles.copyText}>Memo: {solanaPayment.memo}</Text>
                <Text style={styles.copyCta}>Copy</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.verifyButton, solanaSending && styles.verifyButtonDisabled]}
              onPress={() => void handleEmbeddedSolanaVotePayment()}
              disabled={solanaSending}
            >
              <Text style={styles.verifyButtonText}>
                {solanaSending ? "Sending..." : "Pay from in-app wallet"}
              </Text>
            </Pressable>
            <TextInput
              value={solanaTxHash}
              onChangeText={setSolanaTxHash}
              placeholder="Paste Solana transaction hash"
              placeholderTextColor="#6b7280"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={styles.verifyButton}
              onPress={() => void verifySolanaVotePayment()}
              disabled={solanaVerifying}
            >
              <Text style={styles.verifyButtonText}>
                {solanaVerifying ? "Verifying..." : "Verify Payment"}
              </Text>
            </Pressable>
            <Text style={styles.disclaimer}>
              {solanaPayment.memo
                ? "You must include the memo code in the transfer. Payments without the memo cannot be verified."
                : "No memo is required for this transfer."}
            </Text>
          </View>
        </Modal>
      ) : null}

      {confirmingFlutterwave ? (
        <Modal transparent animationType="fade" visible>
          <View style={styles.statusBackdrop}>
            <View style={styles.statusCard}>
              <Text style={styles.section}>Confirming payment</Text>
              <Text style={styles.metaSub}>
                Your bank charge may complete before Flutterwave finishes the callback. We are checking your payment now.
              </Text>
            </View>
          </View>
        </Modal>
      ) : null}

      {successState ? (
        <Modal transparent animationType="fade" visible>
          <View style={styles.statusBackdrop}>
            <View style={styles.statusCard}>
              <Text style={styles.successBadge}>Success</Text>
              <Text style={styles.section}>Votes added</Text>
              <Text style={styles.successValue}>
                {successState.votes} vote{successState.votes === 1 ? "" : "s"}
              </Text>
              <Text style={styles.metaSub}>
                Payment completed via {successState.method === "CARD" ? "Flutterwave" : "Solana"}.
              </Text>
              <Pressable style={styles.verifyButton} onPress={() => setSuccessState(null)}>
                <Text style={styles.verifyButtonText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  balanceCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  balanceLabel: { color: colors.textMuted },
  balanceValue: { color: colors.text, fontSize: 24, fontWeight: "700" },
  section: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: 8 },
  muted: { color: colors.textMuted, fontSize: 12 },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceAlt,
    minWidth: 72,
    alignItems: "center",
  },
  choiceChipActive: {
    borderColor: "#ff6b35",
    backgroundColor: "rgba(255,107,53,0.12)",
  },
  choiceText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  choiceSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  choiceTextActive: { color: "#ff6b35" },
  methodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  methodChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
  },
  methodChipActive: {
    borderColor: "#ff6b35",
    backgroundColor: "rgba(255,107,53,0.12)",
  },
  flutterwaveChip: {
    alignItems: "center",
    justifyContent: "center",
  },
  flutterwaveLogo: {
    width: 108,
    height: 28,
  },
  methodText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  methodTextActive: { color: "#ff6b35" },
  cardNote: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  payBtn: {
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  payBtnDisabled: { opacity: 0.6 },
  payText: { color: "#0d0d0d", fontWeight: "700", fontSize: 16 },
  guideCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 12,
  },
  guideLabel: { color: "#ff6b35", fontWeight: "700", marginTop: 8 },
  guideStep: { color: colors.textSoft, marginTop: 4, fontSize: 12 },
  guideLink: { color: "#ff6b35", marginTop: 8, fontSize: 12, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  solanaSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "22%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaSub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  copyRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  copyText: { color: colors.text, fontSize: 12, flex: 1 },
  copyCta: { color: "#ff6b35", fontWeight: "700" },
  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  verifyButton: {
    marginTop: 12,
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  verifyButtonDisabled: { opacity: 0.6 },
  verifyButtonText: { color: "#0d0d0d", fontWeight: "700" },
  disclaimer: { color: colors.textMuted, fontSize: 11, marginTop: 10 },
  statusBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  statusCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  successBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(34,197,94,0.16)",
    color: "#22c55e",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontWeight: "700",
    overflow: "hidden",
  },
  successValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
  },
});
