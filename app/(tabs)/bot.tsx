import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as ExpoLinking from "expo-linking";
import { Linking } from "react-native";
import { Text } from "@/components/Themed";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { apiFetch } from "@/lib/api";
import * as Clipboard from "expo-clipboard";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { sendEmbeddedSolanaUsdc } from "@/lib/privySolana";

type Sport = "SOCCER" | "BASKETBALL";
type StakeAsset = "USD" | "USDC";

type RolleyPick = {
  id: string;
  external_match_id?: string;
  date: string;
  sport: Sport;
  league: string;
  home_team: string;
  away_team: string;
  kick_off_utc?: string;
  market: string;
  selection: string;
  confidence: number;
  implied_odds?: number;
  rationale: string;
  model_version: string;
  is_primary?: boolean;
  movement_pick_id?: number | null;
  movement_tx_hash?: string | null;
  movement_sync_status?: string | null;
  settlement_outcome?: "PENDING" | "WIN" | "LOSS" | "VOID";
  settlement_notes?: string | null;
  settled_by?: string | null;
  settled_at?: string | null;
  settlement_movement_tx_hash?: string | null;
  created_at: string;
};

type DailyResponse = {
  date: string;
  sport: Sport;
  primary_pick?: RolleyPick | null;
  alternatives?: RolleyPick[];
  picks?: RolleyPick[];
};

type DailyProductLeg = {
  pick_id: string;
  leg_index: number;
  is_primary: boolean;
  market: string;
  selection: string;
  confidence: number;
  implied_odds: number;
};

type DailyProduct = {
  id: string;
  product_date: string;
  sport: Sport;
  kind: "SINGLE" | "BASKET";
  combined_confidence: number;
  combined_odds: number;
  settled_factor?: number | null;
  status: string;
  outcome: "PENDING" | "WIN" | "LOSS" | "VOID";
  rationale: string;
  settled_at?: string | null;
  created_at: string;
  legs: DailyProductLeg[];
};

type DailyProductsResponse = {
  date: string;
  sport: Sport;
  products?: DailyProduct[];
};

type HistoryResponse = {
  sport?: Sport;
  before_date?: string;
  pick_date?: string;
  picks?: RolleyPick[];
};

type StakeStatus = "ACTIVE" | "LOST" | "MATURED" | "WITHDRAWN";

type StakeDailyResult = {
  id: string;
  daily_product_id?: string | null;
  pick_id: string;
  pick_date: string;
  outcome: "PENDING" | "WIN" | "LOSS" | "VOID";
  factor: number;
  starting_amount: number;
  ending_amount: number;
  created_at: string;
};

type StakePosition = {
  id: string;
  user_id: string;
  sport: Sport;
  stake_asset: "USD" | "USDC" | "ROL";
  principal_amount: number;
  current_amount: number;
  lock_days: number;
  days_completed: number;
  days_remaining: number;
  starts_on: string;
  ends_on: string;
  status: StakeStatus;
  total_factor: number;
  gross_profit_amount: number;
  platform_fee_amount: number;
  net_payout_amount: number;
  latest_pick_date?: string | null;
  latest_outcome?: "PENDING" | "WIN" | "LOSS" | "VOID" | null;
  matured_at?: string | null;
  withdrawn_at?: string | null;
  created_at: string;
  updated_at: string;
  daily_results: StakeDailyResult[];
};

const ROLLEY_SERVICE_URL =
  process.env.EXPO_PUBLIC_ROLLEY_SERVICE_URL ?? "https://sportbanter.online/rolley";
const MOVEMENT_EXPLORER_BASE =
  process.env.EXPO_PUBLIC_MOVEMENT_EXPLORER_BASE ?? "https://explorer.movementnetwork.xyz";
const MOVEMENT_EXPLORER_NETWORK = process.env.EXPO_PUBLIC_MOVEMENT_EXPLORER_NETWORK ?? "testnet";
const STAKE_DAY_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

const buildRolleyUrl = (path: string) => {
  const base = ROLLEY_SERVICE_URL.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
};

const formatPct = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
};

const formatDateTime = (iso?: string) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const toUserRationale = (value?: string) => {
  if (!value) return "";
  return value.replace(/\s*\[Data completeness[^\]]*\]\s*$/i, "").trim();
};

const formatLocalDate = (value: Date = new Date()) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const addDaysToDateToken = (dateToken: string, days: number) => {
  const [y, m, d] = dateToken.split("-").map((part) => Number(part));
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
};

const formatAmount = (value?: number, asset: "USD" | "USDC" | "ROL" = "USD") => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  const maximumFractionDigits = asset === "USD" ? 2 : asset === "USDC" ? 6 : 8;
  const formatted = value.toLocaleString(undefined, { maximumFractionDigits });
  return asset === "USD" ? `$${formatted}` : `${formatted} ${asset}`;
};

const pollRolleyFlutterwaveStatus = async (paymentId: string, attempts: number = 15) => {
  for (let i = 0; i < attempts; i += 1) {
    const statusData = await apiFetch(`/payments/flutterwave/rolley/status/${paymentId}`);
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

const getSettlementUi = (outcome?: RolleyPick["settlement_outcome"]) => {
  switch (outcome) {
    case "WIN":
      return { label: "WIN ✅", color: "#22c55e", bg: "rgba(34,197,94,0.16)" };
    case "LOSS":
      return { label: "LOSS ❌", color: "#ef4444", bg: "rgba(239,68,68,0.16)" };
    case "VOID":
      return { label: "VOID ⏺", color: "#eab308", bg: "rgba(234,179,8,0.16)" };
    default:
      return { label: "PENDING", color: "#9ca3af", bg: "rgba(156,163,175,0.14)" };
  }
};

const movementTxUrl = (hash?: string | null) => {
  if (!hash) return "";
  return `${MOVEMENT_EXPLORER_BASE.replace(/\/+$/, "")}/txn/${hash}?network=${MOVEMENT_EXPLORER_NETWORK}`;
};

const chainStatusLabel = (pick?: RolleyPick | null) => {
  if (!pick?.movement_sync_status) return "Not synced on-chain";
  switch (pick.movement_sync_status) {
    case "SETTLED":
      return "Settled on Movement";
    case "CREATED":
      return "Registered on Movement";
    case "SETTLE_FAILED":
      return "Movement settlement failed";
    case "CREATE_FAILED":
      return "Movement registration failed";
    default:
      return pick.movement_sync_status.replace(/_/g, " ");
  }
};

const getStakeStatusTone = (status: StakeStatus) => {
  switch (status) {
    case "MATURED":
      return { color: "#22c55e", bg: "rgba(34,197,94,0.16)" };
    case "LOST":
      return { color: "#ef4444", bg: "rgba(239,68,68,0.16)" };
    case "WITHDRAWN":
      return { color: "#94a3b8", bg: "rgba(148,163,184,0.16)" };
    default:
      return { color: "#f59e0b", bg: "rgba(245,158,11,0.16)" };
  }
};

export default function RolleyBotScreen() {
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [sport, setSport] = useState<Sport>("SOCCER");
  const [picks, setPicks] = useState<RolleyPick[]>([]);
  const [dailyProduct, setDailyProduct] = useState<DailyProduct | null>(null);
  const [primaryPick, setPrimaryPick] = useState<RolleyPick | null>(null);
  const [alternatives, setAlternatives] = useState<RolleyPick[]>([]);
  const [historyPicks, setHistoryPicks] = useState<RolleyPick[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [stakeAsset, setStakeAsset] = useState<StakeAsset>("USD");
  const [stakeAmount, setStakeAmount] = useState("1");
  const [stakeDays, setStakeDays] = useState<number>(5);
  const [stakes, setStakes] = useState<StakePosition[]>([]);
  const [stakeBusy, setStakeBusy] = useState(false);
  const [solanaPayment, setSolanaPayment] = useState<any | null>(null);
  const [solanaTxHash, setSolanaTxHash] = useState("");
  const [solanaVerifying, setSolanaVerifying] = useState(false);
  const [solanaSending, setSolanaSending] = useState(false);
  const solanaWallet = useEmbeddedSolanaWallet();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultAssetSet, setDefaultAssetSet] = useState(false);

  const isNigeriaUser = (user?: { country?: string | null; phone?: string | null }) => {
    const country = (user?.country || "").trim().toLowerCase();
    if (country === "nigeria" || country === "ng") return true;
    const digits = (user?.phone || "").replace(/\D+/g, "");
    return digits.startsWith("234");
  };

  const fetchUserContext = useCallback(async () => {
    try {
      const me = await apiFetch("/auth/me");
      const id = me?.user?.id ? String(me.user.id) : "";
      setUserId(id);
      if (!defaultAssetSet) {
        const nigeria = isNigeriaUser(me?.user || me);
        setStakeAsset(nigeria ? "USD" : "USDC");
        setDefaultAssetSet(true);
      }
    } catch {
      setUserId("");
    }
  }, [defaultAssetSet]);





  const loadStakes = useCallback(async () => {
    if (!userId) {
      setStakes([]);
      return;
    }
    try {
      const response = await fetch(buildRolleyUrl(`/api/v1/stakes?user_id=${encodeURIComponent(userId)}`));
      if (!response.ok) throw new Error(`Stake fetch failed (${response.status})`);
      const data = await response.json();
      setStakes(Array.isArray(data?.stakes) ? data.stakes : []);
    } catch {
      setStakes([]);
    }
  }, [userId]);

  const loadPicks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const normalizeDaily = (data: DailyResponse) => {
        const all = Array.isArray(data?.picks) ? data.picks : [];
        const primary = data?.primary_pick || all.find((pick) => pick?.is_primary) || null;
        const alts = Array.isArray(data?.alternatives)
          ? data.alternatives
          : all.filter((pick) => pick.id !== primary?.id);
        return { all, primary, alts };
      };

      const localToday = formatLocalDate();
      const uniqueDateCandidates =
        sport === "BASKETBALL"
          ? [localToday, addDaysToDateToken(localToday, 1)]
          : [localToday];

      for (const pickDate of uniqueDateCandidates) {
        const [dailyResponse, productResponse] = await Promise.all([
          fetch(buildRolleyUrl(`/api/v1/picks/daily?sport=${sport}&pick_date=${pickDate}`)),
          fetch(buildRolleyUrl(`/api/v1/products/daily?sport=${sport}&pick_date=${pickDate}`)),
        ]);
        if (!dailyResponse.ok) {
          continue;
        }
        const data: DailyResponse = await dailyResponse.json();
        const productData: DailyProductsResponse | null = productResponse.ok ? await productResponse.json() : null;
        const { all, primary, alts } = normalizeDaily(data);
        if (all.length || primary) {
          setDailyProduct(Array.isArray(productData?.products) ? productData!.products![0] ?? null : null);
          setPicks(all);
          setPrimaryPick(primary);
          setAlternatives(alts);
          return;
        }
      }

      setDailyProduct(null);
      setPicks([]);
      setPrimaryPick(null);
      setAlternatives([]);
    } catch (e: any) {
      setError(e?.message || "Failed to load Rolley picks");
      setDailyProduct(null);
      setPicks([]);
      setPrimaryPick(null);
      setAlternatives([]);
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const params = new URLSearchParams({
        sport,
        limit: "12",
      });
      const trimmedDate = historyDate.trim();
      if (trimmedDate) {
        params.set("pick_date", trimmedDate);
      } else {
        params.set("before_date", addDaysToDateToken(formatLocalDate(), -1));
      }
      const response = await fetch(buildRolleyUrl(`/api/v1/picks/history?${params.toString()}`));
      if (!response.ok) {
        throw new Error(`History fetch failed (${response.status})`);
      }
      const data: HistoryResponse = await response.json();
      setHistoryPicks(Array.isArray(data?.picks) ? data.picks : []);
    } catch {
      setHistoryPicks([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyDate, sport]);

  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  useEffect(() => {
    void fetchUserContext();
  }, [fetchUserContext]);

  useEffect(() => {
    void loadStakes();
  }, [loadStakes]);


  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      const tasks = [loadPicks(), fetchUserContext(), loadStakes()];
      if (historyExpanded) {
        tasks.push(loadHistory());
      }
      await Promise.all(tasks);
    } finally {
      setRefreshing(false);
    }
  }, [fetchUserContext, historyExpanded, loadHistory, loadPicks, loadStakes]);

  const onCreateStake = useCallback(async () => {
    const amount = Number(stakeAmount);
    if (!userId) {
      Alert.alert("Stake failed", "User session not found. Please log in again.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Stake failed", `Enter a valid stake amount in ${stakeAsset}.`);
      return;
    }

    try {
      setStakeBusy(true);
      if (stakeAsset === "USD") {
        const redirectUrl = ExpoLinking.createURL("payments/flutterwave/rolley");
        const created = await apiFetch("/payments/flutterwave/rolley/create", {
          method: "POST",
          body: JSON.stringify({
            sport,
            amount,
            lockDays: stakeDays,
            redirectUrl,
          }),
        });

        const result = await WebBrowser.openAuthSessionAsync(created.paymentUrl, redirectUrl);

        let transactionId: string | undefined;
        let txRef: string | undefined = created.reference;

        if (result.type === "success" && result.url) {
          const parsed = ExpoLinking.parse(result.url);
          transactionId = (parsed.queryParams?.transaction_id || parsed.queryParams?.transactionId) as
            | string
            | undefined;
          txRef = (parsed.queryParams?.tx_ref || parsed.queryParams?.txRef) as string | undefined;
        } else if (result.type === "cancel" || result.type === "dismiss") {
          const finalStatus = await pollRolleyFlutterwaveStatus(created.paymentId, 6);
          if (finalStatus !== "COMPLETED") {
            throw new Error("Payment was cancelled.");
          }
        }

        if (transactionId || txRef) {
          const verified = await apiFetch("/payments/flutterwave/rolley/verify", {
            method: "POST",
            body: JSON.stringify({
              paymentId: created.paymentId,
              transactionId,
              txRef,
            }),
          });
          if (verified?.payment?.status !== "COMPLETED") {
            const finalStatus = await pollRolleyFlutterwaveStatus(created.paymentId);
            if (finalStatus !== "COMPLETED") {
              throw new Error("Payment is still pending verification. Please check again shortly.");
            }
          }
        } else {
          const finalStatus = await pollRolleyFlutterwaveStatus(created.paymentId);
          if (finalStatus !== "COMPLETED") {
            throw new Error("Payment is still pending verification. Please check again shortly.");
          }
        }
      } else {
        const created = await apiFetch("/payments/solana/rolley/create", {
          method: "POST",
          body: JSON.stringify({
            sport,
            amount,
            lockDays: stakeDays,
          }),
        });
        setSolanaPayment(created);
        setSolanaTxHash("");
        return;
      }

      try {
        const reward = await apiFetch("/rewards/rolley/first-stake", { method: "POST" });
        if (reward?.awarded) {
          Alert.alert(
            "Stake created",
            `Locked ${formatAmount(amount, stakeAsset)} for ${stakeDays} days.\n\nBonus unlocked: first Rolley stake points awarded.`
          );
        } else {
          Alert.alert("Stake created", `Locked ${formatAmount(amount, stakeAsset)} for ${stakeDays} days.`);
        }
      } catch {
        Alert.alert("Stake created", `Locked ${formatAmount(amount, stakeAsset)} for ${stakeDays} days.`);
      }
      await loadStakes();
    } catch (e: any) {
      Alert.alert("Stake failed", e?.message || "Failed to create stake");
    } finally {
      setStakeBusy(false);
    }
  }, [loadStakes, sport, stakeAmount, stakeAsset, stakeDays, userId]);

  const verifySolanaPayment = useCallback(async (txHashOverride?: string) => {
    const hash = (txHashOverride || solanaTxHash).trim();
    if (!solanaPayment?.paymentId || !hash) {
      Alert.alert("Verify payment", "Paste the Solana transaction hash first.");
      return;
    }
    try {
      setSolanaVerifying(true);
      const verified = await apiFetch("/payments/solana/rolley/verify", {
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
      try {
        const reward = await apiFetch("/rewards/rolley/first-stake", { method: "POST" });
        if (reward?.awarded) {
          Alert.alert(
            "Stake created",
            `Locked ${formatAmount(Number(stakeAmount), stakeAsset)} for ${stakeDays} days.\n\nBonus unlocked: first Rolley stake points awarded.`
          );
        } else {
          Alert.alert(
            "Stake created",
            `Locked ${formatAmount(Number(stakeAmount), stakeAsset)} for ${stakeDays} days.`
          );
        }
      } catch {
        Alert.alert(
          "Stake created",
          `Locked ${formatAmount(Number(stakeAmount), stakeAsset)} for ${stakeDays} days.`
        );
      }
      await loadStakes();
    } catch (e: any) {
      Alert.alert("Verify failed", e?.message || "Failed to verify payment");
    } finally {
      setSolanaVerifying(false);
    }
  }, [loadStakes, solanaPayment, solanaTxHash, stakeAmount, stakeAsset, stakeDays]);

  const handleEmbeddedSolanaStake = useCallback(async () => {
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
        await verifySolanaPayment(result.signature);
      }
    } catch (error) {
      Alert.alert(
        "Payment failed",
        (error as Error)?.message || "Unable to send from the in-app wallet."
      );
    } finally {
      setSolanaSending(false);
    }
  }, [solanaPayment, solanaWallet, verifySolanaPayment]);

  const onWithdrawStake = useCallback(
    async (stakeId: string) => {
      if (!userId) return;
      try {
        setStakeBusy(true);
        const response = await fetch(
          buildRolleyUrl(`/api/v1/stakes/${stakeId}/withdraw?user_id=${encodeURIComponent(userId)}`),
          { method: "POST" }
        );
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Withdraw failed (${response.status})`);
        }
        await loadStakes();
        Alert.alert("Withdraw successful", "Stake payout marked as completed by Banter.");
      } catch (e: any) {
        Alert.alert("Withdraw failed", e?.message || "Failed to withdraw stake");
      } finally {
        setStakeBusy(false);
      }
    },
    [loadStakes, userId]
  );

  const productLegPickIds = useMemo(
    () => new Set((dailyProduct?.legs || []).map((leg) => leg.pick_id)),
    [dailyProduct]
  );

  const candidatePicks = useMemo(() => {
    if (!dailyProduct) return picks;
    return picks.filter((pick) => !productLegPickIds.has(pick.id));
  }, [dailyProduct, picks, productLegPickIds]);

  const topConfidence = useMemo(() => {
    if (!picks.length) return "-";
    const max = picks.reduce((acc, p) => Math.max(acc, p.confidence || 0), 0);
    return formatPct(max);
  }, [picks]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <CenteredHeartbeatLoader
        visible={loading || refreshing}
        text={loading ? "Loading Rolley picks..." : "Refreshing..."}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressBackgroundColor="transparent"
          />
        }
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Rolley Bot</Text>
            <Text style={styles.subtitle}>AI safe-zone picks (Gemini + XGBoost)</Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={() => void onRefresh()}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.metaLabel}>Today</Text>
          <Text style={styles.metaValue}>Top confidence: {topConfidence}</Text>
          <Text style={styles.metaSub}>Stake responsibly. Rolley can still be wrong.</Text>
        </View>

        <View style={styles.sportSwitch}>
          {(["SOCCER", "BASKETBALL"] as Sport[]).map((item) => (
            <Pressable
              key={item}
              style={[styles.sportChip, sport === item && styles.sportChipActive]}
              onPress={() => setSport(item)}
            >
              <Text style={[styles.sportText, sport === item && styles.sportTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Start Rollover Position</Text>
          <Text style={styles.metaSub}>Choose the asset Banter will receive and manage for your rollover.</Text>
          <Text style={styles.metaSub}>Banter receives this stake, rolls it through the daily AI product for your selected duration, then pays you principal plus profit minus Banter's 10% profit fee.</Text>
          <View style={styles.durationRow}>
            {(["USD", "USDC"] as StakeAsset[]).map((asset) => (
              <Pressable
                key={asset}
                style={[styles.durationChip, stakeAsset === asset && styles.durationChipActive]}
                onPress={() => setStakeAsset(asset)}
              >
                <Text style={[styles.durationText, stakeAsset === asset && styles.durationTextActive]}>{asset}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              value={stakeAmount}
              onChangeText={setStakeAmount}
              keyboardType="decimal-pad"
              placeholder={`Amount (${stakeAsset})`}
              placeholderTextColor="#6b7280"
              style={styles.input}
            />
          </View>
          <View style={styles.durationRow}>
            {STAKE_DAY_OPTIONS.map((days) => (
              <Pressable
                key={days}
                style={[styles.durationChip, stakeDays === days && styles.durationChipActive]}
                onPress={() => setStakeDays(days)}
              >
                <Text style={[styles.durationText, stakeDays === days && styles.durationTextActive]}>
                  {days}d
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.stakeButton} disabled={stakeBusy} onPress={() => void onCreateStake()}>
            <Text style={styles.stakeButtonText}>{stakeBusy ? "Processing..." : "Start Managed Rollover"}</Text>
          </Pressable>
          {stakeAsset === "USDC" ? (
            <Text style={styles.disclaimer}>
              USDC uses a manual Solana transfer. Tap "Start Managed Rollover" to get the deposit address,
              then paste the Solana tx hash to verify.
            </Text>
          ) : null}
          <Text style={styles.disclaimer}>
            Your deposit is managed by Banter for the selected rollover period. Movement is used to publish pick and settlement proof, not to hold your stake directly.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Wallet payment guide</Text>
          <Text style={styles.guideLabel}>USDC (Solana)</Text>
          <Text style={styles.guideStep}>1. Tap "Start Managed Rollover" to generate the address and memo.</Text>
          <Text style={styles.guideStep}>2. Send the exact USDC amount to the address and include the memo.</Text>
          <Text style={styles.guideStep}>3. Paste the transaction hash in the app and tap Verify.</Text>
        </View>

        {stakes.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>My Stakes</Text>
            {stakes.map((stake) => (
              <View key={stake.id} style={styles.stakeCard}>
                <View style={styles.stakeHead}>
                  <Text style={styles.stakeSport}>{stake.sport}</Text>
                  <View style={[styles.outcomePill, { backgroundColor: getStakeStatusTone(stake.status).bg }]}>
                    <Text style={[styles.outcomeText, { color: getStakeStatusTone(stake.status).color }]}>
                      {stake.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.stakeLine}>
                  Asset: {stake.stake_asset} • Principal: {formatAmount(stake.principal_amount, stake.stake_asset)} • Current: {formatAmount(stake.current_amount, stake.stake_asset)}
                </Text>
                <Text style={styles.stakeLine}>
                  Period: {stake.lock_days}d • Ends: {stake.ends_on}
                </Text>
                <Text style={styles.stakeLine}>
                  Progress: {stake.days_completed}/{stake.lock_days} day(s) • Remaining: {stake.days_remaining}
                </Text>
                <Text style={styles.stakeLine}>
                  Total factor: x{stake.total_factor.toFixed(3)} • Fee accrued: {formatAmount(stake.platform_fee_amount, stake.stake_asset)}
                </Text>
                {stake.latest_pick_date ? (
                  <Text style={styles.stakeLine}>
                    Latest result: {stake.latest_pick_date} • {stake.latest_outcome || "PENDING"}
                  </Text>
                ) : (
                  <Text style={styles.stakeLine}>Latest result: waiting for the first daily product to settle.</Text>
                )}
                <Text style={styles.stakeChainNote}>
                  Managed rollover: Banter tracks your active position in-app, while Movement publishes pick and settlement proof for transparency.
                </Text>
                {stake.daily_results.length > 0 ? (
                  <View style={styles.dailyTrail}>
                    {stake.daily_results.slice(-3).map((day) => (
                      <View key={day.id} style={styles.dailyTrailRow}>
                        <Text style={styles.dailyTrailDate}>{day.pick_date}</Text>
                        <Text style={styles.dailyTrailText}>
                          {day.outcome} • x{day.factor.toFixed(3)} • {formatAmount(day.starting_amount, stake.stake_asset)} → {formatAmount(day.ending_amount, stake.stake_asset)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {stake.status === "MATURED" ? (
                  <Pressable
                    style={styles.withdrawButton}
                    disabled={stakeBusy}
                    onPress={() => void onWithdrawStake(stake.id)}
                  >
                    <Text style={styles.withdrawButtonText}>Withdraw (10% fee on profit)</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {!error && picks.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.empty}>No picks available yet for {sport}.</Text>
            <Text style={styles.emptySub}>The standalone Rolley cron may still be generating today's slate.</Text>
          </View>
        ) : null}

        {dailyProduct ? (
          <View style={styles.primaryCard}>
            <View style={styles.pickHead}>
              <Text style={styles.primaryLabel}>
                {dailyProduct.kind === "BASKET" ? "Today's Rollover Basket" : "Today's Rollover Product"}
              </Text>
              <Text style={styles.confidence}>{formatPct(dailyProduct.combined_confidence)}</Text>
            </View>
            <View
              style={[
                styles.outcomePill,
                { backgroundColor: getSettlementUi(dailyProduct.outcome).bg },
              ]}
            >
              <Text
                style={[
                  styles.outcomeText,
                  { color: getSettlementUi(dailyProduct.outcome).color },
                ]}
              >
                {getSettlementUi(dailyProduct.outcome).label}
              </Text>
            </View>
            <Text style={styles.match}>
              {dailyProduct.kind === "BASKET" ? `${dailyProduct.legs.length} legs selected for today` : "1 leg selected for today"}
            </Text>
            <Text style={styles.league}>Selected from today's {sport} candidate slate</Text>
            <View style={styles.marketWrap}>
              <Text style={styles.market}>{dailyProduct.kind}</Text>
              <Text style={styles.selection}>Daily factor target</Text>
              <Text style={styles.odds}>Factor x{dailyProduct.combined_odds.toFixed(3)}</Text>
            </View>
            <Text style={styles.reason}>{toUserRationale(dailyProduct.rationale)}</Text>
            <Text style={styles.foot}>Generated: {formatDateTime(dailyProduct.created_at)}</Text>
            <Text style={styles.foot}>Settled: {formatDateTime(dailyProduct.settled_at ?? undefined)}</Text>
            {dailyProduct.legs.map((leg) => {
              const legPick = picks.find((pick) => pick.id === leg.pick_id);
              return (
                <View key={leg.pick_id} style={styles.pickCard}>
                  <View style={styles.pickHead}>
                    <Text style={styles.match}>
                      {legPick ? `${legPick.home_team} vs ${legPick.away_team}` : `Leg ${leg.leg_index + 1}`}
                    </Text>
                    <Text style={styles.confidence}>{formatPct(leg.confidence)}</Text>
                  </View>
                  {legPick ? <Text style={styles.league}>{legPick.league}</Text> : null}
                  <View style={styles.marketWrap}>
                    <Text style={styles.market}>{leg.market}</Text>
                    <Text style={styles.selection}>{leg.selection}</Text>
                    <Text style={styles.odds}>Factor x{leg.implied_odds.toFixed(3)}</Text>
                  </View>
                  {legPick ? (
                    <>
                      <View style={styles.chainRow}>
                        <Text style={styles.chainText}>{chainStatusLabel(legPick)}</Text>
                        {typeof legPick.movement_pick_id === "number" ? (
                          <Text style={styles.chainMeta}>Pick #{legPick.movement_pick_id}</Text>
                        ) : null}
                      </View>
                      <View style={styles.chainLinks}>
                        {legPick.movement_tx_hash ? (
                          <Pressable onPress={() => void Linking.openURL(movementTxUrl(legPick.movement_tx_hash))}>
                            <Text style={styles.chainLink}>View Create Tx</Text>
                          </Pressable>
                        ) : null}
                        {legPick.settlement_movement_tx_hash ? (
                          <Pressable onPress={() => void Linking.openURL(movementTxUrl(legPick.settlement_movement_tx_hash))}>
                            <Text style={styles.chainLink}>View Settle Tx</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </>
                  ) : null}
                </View>
              );
            })}
            <Text style={styles.stakeNote}>
              This is today's final rollover product. Banter uses it to manage active rollover positions, while Movement stores proof that the pick and its result were published publicly.
            </Text>
          </View>
        ) : null}

        {candidatePicks.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.altTitle}>Candidate Picks</Text>
            <Text style={styles.metaSub}>These were reasoned candidates for today but are not the final rollover product.</Text>
          </View>
        ) : null}

        {candidatePicks.map((pick) => (
          <View key={pick.id} style={styles.pickCard}>
            <View style={styles.pickHead}>
              <Text style={styles.match}>{pick.home_team} vs {pick.away_team}</Text>
              <View style={styles.pickMeta}>
                {pick.is_primary ? (
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryBadgeText}>Primary</Text>
                  </View>
                ) : null}
                <Text style={styles.confidence}>{formatPct(pick.confidence)}</Text>
              </View>
            </View>
            <View
              style={[styles.outcomePill, { backgroundColor: getSettlementUi(pick.settlement_outcome).bg }]}
            >
              <Text style={[styles.outcomeText, { color: getSettlementUi(pick.settlement_outcome).color }]}>
                {getSettlementUi(pick.settlement_outcome).label}
              </Text>
            </View>
            <Text style={styles.league}>{pick.league}</Text>
            <View style={styles.marketWrap}>
              <Text style={styles.market}>{pick.market}</Text>
              <Text style={styles.selection}>{pick.selection}</Text>
              {typeof pick.implied_odds === "number" ? (
                <Text style={styles.odds}>Factor x{pick.implied_odds.toFixed(3)}</Text>
              ) : null}
            </View>
            <Text style={styles.reason}>{toUserRationale(pick.rationale)}</Text>
            <Text style={styles.foot}>Generated: {formatDateTime(pick.created_at)}</Text>
            <Text style={styles.foot}>Settled: {formatDateTime(pick.settled_at ?? undefined)}</Text>
            <View style={styles.chainRow}>
              <Text style={styles.chainText}>{chainStatusLabel(pick)}</Text>
              {typeof pick.movement_pick_id === "number" ? (
                <Text style={styles.chainMeta}>Pick #{pick.movement_pick_id}</Text>
              ) : null}
            </View>
            <View style={styles.chainLinks}>
              {pick.movement_tx_hash ? (
                <Pressable onPress={() => void Linking.openURL(movementTxUrl(pick.movement_tx_hash))}>
                  <Text style={styles.chainLink}>Create Tx</Text>
                </Pressable>
              ) : null}
              {pick.settlement_movement_tx_hash ? (
                <Pressable onPress={() => void Linking.openURL(movementTxUrl(pick.settlement_movement_tx_hash))}>
                  <Text style={styles.chainLink}>Settle Tx</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        <View style={styles.card}>
          <View style={styles.historyHead}>
            <View>
              <Text style={styles.altTitle}>Prediction History</Text>
              <Text style={styles.metaSub}>Open history and load a specific day.</Text>
            </View>
            <Pressable
              style={styles.historyToggle}
              onPress={() => {
                const next = !historyExpanded;
                setHistoryExpanded(next);
                if (next) {
                  void loadHistory();
                }
              }}
            >
              <Text style={styles.historyToggleText}>{historyExpanded ? "Hide" : "View"}</Text>
            </Pressable>
          </View>

          {historyExpanded ? (
            <>
              <View style={styles.inputRow}>
                <TextInput
                  value={historyDate}
                  onChangeText={setHistoryDate}
                  keyboardType="numbers-and-punctuation"
                  placeholder="YYYY-MM-DD (optional)"
                  placeholderTextColor="#6b7280"
                  style={styles.input}
                />
              </View>
              <Pressable
                style={styles.historyLoadButton}
                disabled={historyLoading}
                onPress={() => void loadHistory()}
              >
                <Text style={styles.historyLoadButtonText}>
                  {historyLoading ? "Loading..." : historyDate.trim() ? "Load Date" : "Load Recent History"}
                </Text>
              </Pressable>
              {!historyLoading && historyPicks.length === 0 ? (
                <Text style={styles.emptySub}>
                  {historyDate.trim() ? "No picks found for that date." : "No previous picks found yet."}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        {historyExpanded &&
          historyPicks.map((pick) => (
            <View key={pick.id} style={styles.pickCard}>
              <View style={styles.pickHead}>
                <Text style={styles.match}>{pick.home_team} vs {pick.away_team}</Text>
                <Text style={styles.confidence}>{formatPct(pick.confidence)}</Text>
              </View>
              <View
                style={[styles.outcomePill, { backgroundColor: getSettlementUi(pick.settlement_outcome).bg }]}
              >
                <Text style={[styles.outcomeText, { color: getSettlementUi(pick.settlement_outcome).color }]}>
                  {getSettlementUi(pick.settlement_outcome).label}
                </Text>
              </View>
              <Text style={styles.league}>
                {pick.sport} • {pick.date} • {pick.league}
              </Text>
              <View style={styles.marketWrap}>
                <Text style={styles.market}>{pick.market}</Text>
                <Text style={styles.selection}>{pick.selection}</Text>
                {typeof pick.implied_odds === "number" ? (
                  <Text style={styles.odds}>Factor x{pick.implied_odds.toFixed(3)}</Text>
                ) : null}
              </View>
              <Text style={styles.reason}>{toUserRationale(pick.rationale)}</Text>
              <Text style={styles.foot}>Generated: {formatDateTime(pick.created_at)}</Text>
              <Text style={styles.foot}>Settled: {formatDateTime(pick.settled_at ?? undefined)}</Text>
              <View style={styles.chainRow}>
                <Text style={styles.chainText}>{chainStatusLabel(pick)}</Text>
                {typeof pick.movement_pick_id === "number" ? (
                  <Text style={styles.chainMeta}>Pick #{pick.movement_pick_id}</Text>
                ) : null}
                {pick.settled_by ? <Text style={styles.chainMeta}>By: {pick.settled_by}</Text> : null}
              </View>
              <View style={styles.chainLinks}>
                {pick.movement_tx_hash ? (
                  <Pressable onPress={() => void Linking.openURL(movementTxUrl(pick.movement_tx_hash))}>
                    <Text style={styles.chainLink}>Create Tx</Text>
                  </Pressable>
                ) : null}
                {pick.settlement_movement_tx_hash ? (
                  <Pressable onPress={() => void Linking.openURL(movementTxUrl(pick.settlement_movement_tx_hash))}>
                    <Text style={styles.chainLink}>Settle Tx</Text>
                  </Pressable>
                ) : null}
              </View>
              </View>
          ))}
      </ScrollView>

      {solanaPayment ? (
        <Modal transparent animationType="fade" visible>
          <Pressable style={styles.modalBackdrop} onPress={() => setSolanaPayment(null)} />
          <View style={styles.solanaSheet}>
            <Text style={styles.sectionTitle}>Send USDC (Solana)</Text>
            <Text style={styles.metaSub}>
              Send exactly {formatAmount(solanaPayment.amount, "USDC")} to:
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
              style={[styles.stakeButton, solanaSending && styles.stakeButtonDisabled]}
              onPress={() => void handleEmbeddedSolanaStake()}
              disabled={solanaSending}
            >
              <Text style={styles.stakeButtonText}>
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
              style={styles.stakeButton}
              onPress={() => void verifySolanaPayment()}
              disabled={solanaVerifying}
            >
              <Text style={styles.stakeButtonText}>
                {solanaVerifying ? "Verifying..." : "Verify Payment"}
              </Text>
            </Pressable>
            <Text style={styles.disclaimer}>
              You must include the memo code in the transfer. Payments without the memo cannot be verified.
            </Text>
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
    content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 40, gap: 10 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    title: { color: colors.text, fontSize: 20, fontWeight: "700" },
    subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
    refreshBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    refreshText: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
    sectionTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
    metaLabel: { color: colors.textMuted, fontSize: 11 },
    metaValue: { color: colors.text, fontSize: 12, fontWeight: "600" },
    metaSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    inputRow: { marginTop: 8 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      backgroundColor: colors.input,
      fontSize: 13,
    },
    durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    durationChip: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
    },
    durationChipActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.14)" },
    durationText: { color: colors.text, fontSize: 12, fontWeight: "700" },
    durationTextActive: { color: "#ff6b35" },
    stakeButton: {
      marginTop: 12,
      backgroundColor: "#ff6b35",
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: "center",
    },
    stakeButtonDisabled: { opacity: 0.6 },
    stakeButtonText: { color: "#16120c", fontWeight: "800", fontSize: 13 },
    disclaimer: { color: colors.textMuted, fontSize: 11, marginTop: 8, lineHeight: 16 },
    guideLabel: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 10 },
    guideStep: { color: colors.textSoft, fontSize: 11, marginTop: 4, lineHeight: 16 },
    stakeCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 10,
      marginTop: 8,
      backgroundColor: colors.surfaceAlt,
    },
    stakeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    stakeSport: { color: colors.text, fontSize: 12, fontWeight: "700" },
    stakeLine: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
    stakeChainNote: { color: colors.textMuted, fontSize: 10, marginTop: 6, lineHeight: 15 },
    dailyTrail: { marginTop: 8, gap: 4 },
    dailyTrailRow: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: colors.surfaceAlt,
    },
    dailyTrailDate: { color: colors.text, fontSize: 10, fontWeight: "700" },
    dailyTrailText: { color: colors.textSoft, fontSize: 10, marginTop: 2 },
    withdrawButton: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: "#3b82f6",
      borderRadius: 8,
      paddingVertical: 7,
      alignItems: "center",
      backgroundColor: "rgba(59,130,246,0.14)",
    },
    withdrawButtonText: { color: "#93c5fd", fontSize: 11, fontWeight: "700" },
    sportSwitch: { flexDirection: "row", gap: 8 },
    sportChip: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surfaceAlt,
    },
    sportChipActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.14)" },
    sportText: { color: colors.text, fontWeight: "700", fontSize: 12 },
    sportTextActive: { color: "#ff6b35" },
    error: { color: "#f87171", fontSize: 12 },
    empty: { color: colors.text, fontSize: 13, fontWeight: "700" },
    emptySub: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlayStrong,
    },
    solanaSheet: {
      position: "absolute",
      left: 16,
      right: 16,
      top: "20%",
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    copyRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.input,
    },
    copyText: { color: colors.text, fontSize: 12, flex: 1 },
    copyCta: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
    historyHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    historyToggle: {
      borderWidth: 1,
      borderColor: "#ff6b35",
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: "rgba(255,107,53,0.12)",
    },
    historyToggleText: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
    historyLoadButton: {
      marginTop: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingVertical: 10,
      alignItems: "center",
    },
    historyLoadButtonText: { color: colors.text, fontWeight: "700", fontSize: 12 },
    pickCard: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      gap: 6,
    },
    primaryCard: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: "#ff6b35",
      borderRadius: 12,
      padding: 12,
      gap: 6,
    },
    primaryLabel: {
      color: "#ff6b35",
      fontSize: 11,
      fontWeight: "700",
    },
    altTitle: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 13,
    },
    pickHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    pickMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
    primaryBadge: {
      backgroundColor: "rgba(16,185,129,0.15)",
      borderColor: "rgba(16,185,129,0.4)",
      borderWidth: 1,
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 999,
    },
    primaryBadgeText: { color: "#34d399", fontSize: 11, fontWeight: "700" },
    match: { color: colors.text, fontSize: 14, fontWeight: "700", flex: 1 },
    confidence: { color: "#22c55e", fontSize: 13, fontWeight: "700" },
    league: { color: colors.textMuted, fontSize: 12 },
    marketWrap: { flexDirection: "row", gap: 8, alignItems: "center" },
    market: {
      color: "#ff6b35",
      fontSize: 11,
      fontWeight: "700",
      backgroundColor: "rgba(255,107,53,0.15)",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    selection: { color: colors.text, fontSize: 12, fontWeight: "700" },
    odds: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
    reason: { color: colors.textSoft, fontSize: 12, lineHeight: 17 },
    foot: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
    chainRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4, alignItems: "center" },
    chainText: { color: "#93c5fd", fontSize: 10, fontWeight: "700" },
    chainMeta: { color: "#94a3b8", fontSize: 10 },
    chainLinks: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2 },
    chainLink: { color: "#60a5fa", fontSize: 10, fontWeight: "700" },
    userChainBox: {
      marginTop: 6,
      borderWidth: 1,
      borderColor: "#1d4ed8",
      backgroundColor: "rgba(29,78,216,0.10)",
      borderRadius: 10,
      padding: 8,
      gap: 2,
    },
    userChainTitle: { color: "#bfdbfe", fontSize: 10, fontWeight: "700" },
    userChainLine: { color: "#dbeafe", fontSize: 10 },
    userChainHint: { color: "#bfdbfe", fontSize: 10, lineHeight: 14, marginTop: 4 },
    stakeNote: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    outcomePill: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginTop: 2,
    },
    outcomeText: {
      fontSize: 11,
      fontWeight: "700",
    },
  });
