import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/expo";
import { useCreateWallet, useSignRawHash } from "@privy-io/expo/extended-chains";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { apiFetch } from "@/lib/api";
import { getMovementWallet, getMovementWalletByAddress, sendMovementTransaction } from "@/lib/privyMovement";

type Sport = "SOCCER" | "BASKETBALL";

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

type HistoryResponse = {
  sport?: Sport;
  before_date?: string;
  pick_date?: string;
  picks?: RolleyPick[];
};

type MovementWalletPickStatus = {
  movement_pick_id: number;
  wallet_address: string;
  pick_status: string;
  staked_raw: string;
  staked_rol: number;
  claimable_raw: string;
  claimable_rol: number;
  eligible_to_claim: boolean;
};

type MovementWalletStatusResponse = {
  wallet_address: string;
  statuses?: MovementWalletPickStatus[];
};

type StakeStatus = "ACTIVE" | "LOST" | "MATURED" | "WITHDRAWN";

type StakePosition = {
  id: string;
  user_id: string;
  sport: Sport;
  principal_rol: number;
  current_rol: number;
  lock_days: number;
  starts_on: string;
  ends_on: string;
  status: StakeStatus;
  total_factor: number;
  gross_profit_rol: number;
  platform_fee_rol: number;
  net_payout_rol: number;
  matured_at?: string | null;
  withdrawn_at?: string | null;
  created_at: string;
  updated_at: string;
};

const ROLLEY_SERVICE_URL =
  process.env.EXPO_PUBLIC_ROLLEY_SERVICE_URL ?? "https://sportbanter.online/rolley";
const MOVEMENT_EXPLORER_BASE =
  process.env.EXPO_PUBLIC_MOVEMENT_EXPLORER_BASE ?? "https://explorer.movementnetwork.xyz";
const MOVEMENT_EXPLORER_NETWORK = process.env.EXPO_PUBLIC_MOVEMENT_EXPLORER_NETWORK ?? "testnet";
const MOVEMENT_SETTLEMENT_MODULE_ADDRESS = process.env.EXPO_PUBLIC_MOVEMENT_SETTLEMENT_MODULE_ADDRESS ?? "";
const MOVEMENT_ROL_DECIMALS = Number(process.env.EXPO_PUBLIC_MOVEMENT_ROL_DECIMALS ?? "8");
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

const formatRol = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
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

const toMovementRolRaw = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  return Math.floor(amount * 10 ** MOVEMENT_ROL_DECIMALS).toString();
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

export default function RolleyBotScreen() {
  const { user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const [sport, setSport] = useState<Sport>("SOCCER");
  const [picks, setPicks] = useState<RolleyPick[]>([]);
  const [primaryPick, setPrimaryPick] = useState<RolleyPick | null>(null);
  const [alternatives, setAlternatives] = useState<RolleyPick[]>([]);
  const [historyPicks, setHistoryPicks] = useState<RolleyPick[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [movementAddress, setMovementAddress] = useState<string>("");
  const [rolBalance, setRolBalance] = useState<number>(0);
  const [stakeAmount, setStakeAmount] = useState("1");
  const [stakeDays, setStakeDays] = useState<number>(5);
  const [stakes, setStakes] = useState<StakePosition[]>([]);
  const [stakeBusy, setStakeBusy] = useState(false);
  const [movementStakeBusy, setMovementStakeBusy] = useState(false);
  const [movementStatusByPickId, setMovementStatusByPickId] = useState<Record<number, MovementWalletPickStatus>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserContext = useCallback(async () => {
    try {
      const me = await apiFetch("/auth/me");
      const id = me?.user?.id ? String(me.user.id) : "";
      const raw = Number(me?.user?.rolBalanceRaw || 0);
      setUserId(id);
      setMovementAddress(String(me?.user?.movementAddress || ""));
      setRolBalance(Number.isFinite(raw) ? raw / 1e8 : 0);
    } catch {
      setUserId("");
      setMovementAddress("");
      setRolBalance(0);
    }
  }, []);

  const resolveMovementWallet = useCallback(async () => {
    let wallet = getMovementWalletByAddress(user, movementAddress) || getMovementWallet(user);
    if (wallet?.address) {
      return wallet;
    }
    try {
      await createWallet({ chainType: "movement" });
    } catch (error) {
      const message = ((error as Error)?.message || "").toLowerCase();
      const alreadyExists =
        message.includes("already has an embedded wallet") ||
        message.includes("already has an account of the type linked") ||
        message.includes("already has a wallet");
      if (!alreadyExists) {
        await createWallet({ chainType: "aptos" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    wallet = getMovementWalletByAddress(user, movementAddress) || getMovementWallet(user);
    if (!wallet?.address) {
      throw new Error("Movement wallet not available in this session. Log out and sign in again.");
    }
    return wallet;
  }, [createWallet, movementAddress, user]);

  const loadMovementStatuses = useCallback(async () => {
    const walletAddress = movementAddress || getMovementWallet(user)?.address || "";
    const visiblePicks = [
      ...(primaryPick ? [primaryPick] : []),
      ...alternatives,
      ...(historyExpanded ? historyPicks : []),
    ];
    const pickIds = Array.from(
      new Set(
        visiblePicks
          .map((pick) => pick.movement_pick_id)
          .filter((value): value is number => typeof value === "number" && value > 0)
      )
    );

    if (!walletAddress || pickIds.length === 0) {
      setMovementStatusByPickId({});
      return;
    }

    try {
      const params = new URLSearchParams({
        wallet_address: walletAddress,
        pick_ids: pickIds.join(","),
      });
      const response = await fetch(buildRolleyUrl(`/api/v1/movement/status?${params.toString()}`));
      if (!response.ok) {
        throw new Error(`Movement status fetch failed (${response.status})`);
      }
      const data: MovementWalletStatusResponse = await response.json();
      const next: Record<number, MovementWalletPickStatus> = {};
      for (const item of data.statuses || []) {
        next[item.movement_pick_id] = item;
      }
      setMovementStatusByPickId(next);
    } catch {
      setMovementStatusByPickId({});
    }
  }, [alternatives, historyExpanded, historyPicks, movementAddress, primaryPick, user]);

  const onStakeOnMovement = useCallback(async () => {
    if (!primaryPick?.movement_pick_id) {
      Alert.alert("Movement stake unavailable", "This pick is not registered on Movement yet.");
      return;
    }
    if (!MOVEMENT_SETTLEMENT_MODULE_ADDRESS) {
      Alert.alert("Movement stake unavailable", "Movement settlement module address is not configured in this build.");
      return;
    }

    const amount = Number(stakeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Movement stake failed", "Enter a valid Movement stake amount in ROL.");
      return;
    }

    try {
      setMovementStakeBusy(true);
      const wallet = await resolveMovementWallet();
      const publicKey = wallet.publicKey || wallet.public_key;
      if (!publicKey) {
        throw new Error("Movement wallet public key not available.");
      }
      const walletAddress = String(wallet.address);
      const txHash = await sendMovementTransaction(
        {
          type: "entry_function_payload",
          function: `${MOVEMENT_SETTLEMENT_MODULE_ADDRESS}::rolley_settlement::stake_on_pick`,
          type_arguments: [],
          arguments: [
            String(primaryPick.movement_pick_id),
            "1",
            toMovementRolRaw(amount),
            String(Math.floor(Date.now() / 1000)),
          ],
        },
        walletAddress,
        publicKey,
        signRawHash as any
      );
      setMovementAddress(walletAddress);
      await loadMovementStatuses();
      Alert.alert("Movement stake submitted", `Your on-chain stake was submitted.

Tx: ${txHash}`);
    } catch (e: any) {
      Alert.alert("Movement stake failed", e?.message || "Failed to submit on-chain stake.");
    } finally {
      setMovementStakeBusy(false);
    }
  }, [loadMovementStatuses, primaryPick, resolveMovementWallet, signRawHash, stakeAmount]);

  const renderWalletMovementStatus = (pick?: RolleyPick | null) => {
    if (!pick || typeof pick.movement_pick_id !== "number") return null;
    const status = movementStatusByPickId[pick.movement_pick_id];
    if (!status) return null;
    return (
      <View style={styles.userChainBox}>
        <Text style={styles.userChainTitle}>Your Movement status</Text>
        <Text style={styles.userChainLine}>On-chain pick: #{status.movement_pick_id}</Text>
        <Text style={styles.userChainLine}>Pick state: {status.pick_status}</Text>
        <Text style={styles.userChainLine}>Stake on-chain: {formatRol(status.staked_rol)} ROL</Text>
        <Text style={styles.userChainLine}>
          Claim status: {status.eligible_to_claim ? `Eligible (${formatRol(status.claimable_rol)} ROL)` : "Not claimable yet"}
        </Text>
        <Text style={styles.userChainHint}>
          Claim release is still handled by Rolley after settlement. Your wallet status here is read from Movement.
        </Text>
      </View>
    );
  };

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
        const response = await fetch(buildRolleyUrl(`/api/v1/picks/daily?sport=${sport}&pick_date=${pickDate}`));
        if (!response.ok) {
          continue;
        }
        const data: DailyResponse = await response.json();
        const { all, primary, alts } = normalizeDaily(data);
        if (all.length || primary) {
          setPicks(all);
          setPrimaryPick(primary);
          setAlternatives(alts);
          return;
        }
      }

      setPicks([]);
      setPrimaryPick(null);
      setAlternatives([]);
    } catch (e: any) {
      setError(e?.message || "Failed to load Rolley picks");
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

  useEffect(() => {
    void loadMovementStatuses();
  }, [loadMovementStatuses]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await loadPicks();
      if (historyExpanded) {
        await loadHistory();
      }
      await fetchUserContext();
      await loadStakes();
      await loadMovementStatuses();
    } finally {
      setRefreshing(false);
    }
  }, [fetchUserContext, historyExpanded, loadHistory, loadMovementStatuses, loadPicks, loadStakes]);

  const onCreateStake = useCallback(async () => {
    const amount = Number(stakeAmount);
    if (!userId) {
      Alert.alert("Stake failed", "User session not found. Please log in again.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Stake failed", "Enter a valid stake amount in ROL.");
      return;
    }
    if (amount > rolBalance) {
      Alert.alert("Stake failed", "Insufficient ROL balance.");
      return;
    }

    try {
      setStakeBusy(true);
      const response = await fetch(buildRolleyUrl("/api/v1/stakes/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          sport,
          amount_rol: amount,
          lock_days: stakeDays,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Stake create failed (${response.status})`);
      }
      try {
        const reward = await apiFetch("/rewards/rolley/first-stake", { method: "POST" });
        if (reward?.awarded) {
          Alert.alert(
            "Stake created",
            `Locked ${amount} ROL for ${stakeDays} days.\n\nBonus unlocked: first Rolley stake points awarded.`
          );
        } else {
          Alert.alert("Stake created", `Locked ${amount} ROL for ${stakeDays} days.`);
        }
      } catch {
        Alert.alert("Stake created", `Locked ${amount} ROL for ${stakeDays} days.`);
      }
      await loadStakes();
    } catch (e: any) {
      Alert.alert("Stake failed", e?.message || "Failed to create stake");
    } finally {
      setStakeBusy(false);
    }
  }, [loadStakes, rolBalance, sport, stakeAmount, stakeDays, userId]);

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
        Alert.alert("Withdraw successful", "Stake payout moved to your in-app ROL balance.");
      } catch (e: any) {
        Alert.alert("Withdraw failed", e?.message || "Failed to withdraw stake");
      } finally {
        setStakeBusy(false);
      }
    },
    [loadStakes, userId]
  );

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
          <Text style={styles.sectionTitle}>Stake ROL</Text>
          <Text style={styles.metaSub}>Available ROL: {formatRol(rolBalance)}</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={stakeAmount}
              onChangeText={setStakeAmount}
              keyboardType="decimal-pad"
              placeholder="Amount (ROL)"
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
            <Text style={styles.stakeButtonText}>{stakeBusy ? "Processing..." : "Stake Now"}</Text>
          </Pressable>
          <Text style={styles.disclaimer}>
            Rolley uses safety-first predictions but can still lose. Stake only what you can afford.
          </Text>
        </View>

        {stakes.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>My Stakes</Text>
            {stakes.map((stake) => (
              <View key={stake.id} style={styles.stakeCard}>
                <View style={styles.stakeHead}>
                  <Text style={styles.stakeSport}>{stake.sport}</Text>
                  <Text style={styles.stakeStatus}>{stake.status}</Text>
                </View>
                <Text style={styles.stakeLine}>
                  Principal: {formatRol(stake.principal_rol)} ROL • Current: {formatRol(stake.current_rol)} ROL
                </Text>
                <Text style={styles.stakeLine}>
                  Period: {stake.lock_days}d • Ends: {stake.ends_on}
                </Text>
                <Text style={styles.stakeChainNote}>
                  Chain status: pick registration and settlement are on Movement. Your personal stake balance is still tracked in-app for now.
                </Text>
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

        {primaryPick ? (
          <View style={styles.primaryCard}>
            <View style={styles.pickHead}>
              <Text style={styles.primaryLabel}>Primary Pick (used for stake)</Text>
              <Text style={styles.confidence}>{formatPct(primaryPick.confidence)}</Text>
            </View>
            <View
              style={[
                styles.outcomePill,
                { backgroundColor: getSettlementUi(primaryPick.settlement_outcome).bg },
              ]}
            >
              <Text
                style={[
                  styles.outcomeText,
                  { color: getSettlementUi(primaryPick.settlement_outcome).color },
                ]}
              >
                {getSettlementUi(primaryPick.settlement_outcome).label}
              </Text>
            </View>
            <Text style={styles.match}>{primaryPick.home_team} vs {primaryPick.away_team}</Text>
            <Text style={styles.league}>{primaryPick.league}</Text>
            <View style={styles.marketWrap}>
              <Text style={styles.market}>{primaryPick.market}</Text>
              <Text style={styles.selection}>{primaryPick.selection}</Text>
              {typeof primaryPick.implied_odds === "number" ? (
                <Text style={styles.odds}>x{primaryPick.implied_odds.toFixed(3)}</Text>
              ) : null}
            </View>
            <Text style={styles.reason}>{toUserRationale(primaryPick.rationale)}</Text>
            <Text style={styles.foot}>Generated: {formatDateTime(primaryPick.created_at)}</Text>
            <Text style={styles.foot}>Settled: {formatDateTime(primaryPick.settled_at ?? undefined)}</Text>
            <View style={styles.chainRow}>
              <Text style={styles.chainText}>{chainStatusLabel(primaryPick)}</Text>
              {typeof primaryPick.movement_pick_id === "number" ? (
                <Text style={styles.chainMeta}>Pick #{primaryPick.movement_pick_id}</Text>
              ) : null}
              {primaryPick.settled_by ? <Text style={styles.chainMeta}>By: {primaryPick.settled_by}</Text> : null}
            </View>
            <View style={styles.chainLinks}>
              {primaryPick.movement_tx_hash ? (
                <Pressable onPress={() => void Linking.openURL(movementTxUrl(primaryPick.movement_tx_hash))}>
                  <Text style={styles.chainLink}>View Create Tx</Text>
                </Pressable>
              ) : null}
              {primaryPick.settlement_movement_tx_hash ? (
                <Pressable onPress={() => void Linking.openURL(movementTxUrl(primaryPick.settlement_movement_tx_hash))}>
                  <Text style={styles.chainLink}>View Settle Tx</Text>
                </Pressable>
              ) : null}
            </View>
            {renderWalletMovementStatus(primaryPick)}
            <Pressable style={styles.movementStakeButton} disabled={movementStakeBusy} onPress={() => void onStakeOnMovement()}>
              <Text style={styles.movementStakeButtonText}>
                {movementStakeBusy ? "Submitting Movement stake..." : "Stake This Pick on Movement"}
              </Text>
            </Pressable>
            <Text style={styles.stakeNote}>Stake engine uses this primary pick only. Movement staking uses your Movement wallet, not your in-app ROL balance.</Text>
          </View>
        ) : null}

        {alternatives.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.altTitle}>Alternative Picks</Text>
          </View>
        ) : null}

        {alternatives.map((pick) => (
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
            <Text style={styles.league}>{pick.league}</Text>
            <View style={styles.marketWrap}>
              <Text style={styles.market}>{pick.market}</Text>
              <Text style={styles.selection}>{pick.selection}</Text>
              {typeof pick.implied_odds === "number" ? (
                <Text style={styles.odds}>x{pick.implied_odds.toFixed(3)}</Text>
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
            {renderWalletMovementStatus(pick)}
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
                  <Text style={styles.odds}>x{pick.implied_odds.toFixed(3)}</Text>
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
              {renderWalletMovementStatus(pick)}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 40, gap: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#fafafa", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#9ca3af", fontSize: 12, marginTop: 3 },
  refreshBtn: {
    borderWidth: 1,
    borderColor: "#2c2c2c",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  refreshText: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
  card: {
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "#232323",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  sectionTitle: { color: "#fafafa", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  metaLabel: { color: "#9ca3af", fontSize: 11 },
  metaValue: { color: "#fafafa", fontSize: 12, fontWeight: "600" },
  metaSub: { color: "#d1d5db", fontSize: 11, marginTop: 2 },
  inputRow: { marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#2c2c2c",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f3f4f6",
    backgroundColor: "#0b0b0b",
    fontSize: 13,
  },
  durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  durationChip: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#111",
  },
  durationChipActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.14)" },
  durationText: { color: "#e5e7eb", fontSize: 12, fontWeight: "700" },
  durationTextActive: { color: "#ff6b35" },
  stakeButton: {
    marginTop: 12,
    backgroundColor: "#ff6b35",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  stakeButtonText: { color: "#16120c", fontWeight: "800", fontSize: 13 },
  movementStakeButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3b82f6",
    backgroundColor: "rgba(59,130,246,0.12)",
    paddingVertical: 10,
    alignItems: "center",
  },
  movementStakeButtonText: { color: "#bfdbfe", fontWeight: "800", fontSize: 12 },
  disclaimer: { color: "#9ca3af", fontSize: 11, marginTop: 8, lineHeight: 16 },
  stakeCard: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    backgroundColor: "#0f0f0f",
  },
  stakeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stakeSport: { color: "#f9fafb", fontSize: 12, fontWeight: "700" },
  stakeStatus: { color: "#22c55e", fontSize: 11, fontWeight: "700" },
  stakeLine: { color: "#d1d5db", fontSize: 11, marginTop: 4 },
  stakeChainNote: { color: "#94a3b8", fontSize: 10, marginTop: 6, lineHeight: 15 },
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
    borderColor: "#333",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#111",
  },
  sportChipActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.14)" },
  sportText: { color: "#e5e7eb", fontWeight: "700", fontSize: 12 },
  sportTextActive: { color: "#ff6b35" },
  error: { color: "#f87171", fontSize: 12 },
  empty: { color: "#e5e7eb", fontSize: 13, fontWeight: "700" },
  emptySub: { color: "#9ca3af", fontSize: 11, marginTop: 3 },
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
    borderColor: "#2c2c2c",
    backgroundColor: "#111",
    paddingVertical: 10,
    alignItems: "center",
  },
  historyLoadButtonText: { color: "#f3f4f6", fontWeight: "700", fontSize: 12 },
  pickCard: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#242424",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  primaryCard: {
    backgroundColor: "#111",
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
    color: "#f5f5f5",
    fontWeight: "700",
    fontSize: 13,
  },
  pickHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  match: { color: "#fafafa", fontSize: 14, fontWeight: "700", flex: 1 },
  confidence: { color: "#22c55e", fontSize: 13, fontWeight: "700" },
  league: { color: "#9ca3af", fontSize: 12 },
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
  selection: { color: "#fff", fontSize: 12, fontWeight: "700" },
  odds: { color: "#9ca3af", fontSize: 11, fontWeight: "600" },
  reason: { color: "#d1d5db", fontSize: 12, lineHeight: 17 },
  foot: { color: "#6b7280", fontSize: 10, marginTop: 2 },
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
  stakeNote: { color: "#9ca3af", fontSize: 11, marginTop: 2 },
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
