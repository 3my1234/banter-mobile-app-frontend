import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";

type Sport = "SOCCER" | "BASKETBALL";

type RolleyPick = {
  id: string;
  date: string;
  sport: Sport;
  league: string;
  home_team: string;
  away_team: string;
  market: string;
  selection: string;
  confidence: number;
  rationale: string;
  model_version: string;
  created_at: string;
};

const ROLLEY_SERVICE_URL =
  process.env.EXPO_PUBLIC_ROLLEY_SERVICE_URL ?? "https://sportbanter.online/rolley";

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

export default function RolleyBotScreen() {
  const [sport, setSport] = useState<Sport>("SOCCER");
  const [picks, setPicks] = useState<RolleyPick[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPicks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const today = new Date().toISOString().slice(0, 10);
      const response = await fetch(
        buildRolleyUrl(`/api/v1/picks/daily?sport=${sport}&pick_date=${today}`)
      );
      if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(message || `Rolley service error (${response.status})`);
      }
      const data = await response.json();
      setPicks(Array.isArray(data?.picks) ? data.picks : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load Rolley picks");
      setPicks([]);
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  const onRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await loadPicks();
    } finally {
      setRefreshing(false);
    }
  }, [loadPicks]);

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
          <Text style={styles.metaLabel}>Service</Text>
          <Text style={styles.metaValue}>{ROLLEY_SERVICE_URL}</Text>
          <Text style={styles.metaSub}>Top confidence today: {topConfidence}</Text>
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

        {error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {!error && picks.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.empty}>No picks available yet for {sport}.</Text>
            <Text style={styles.emptySub}>The standalone Rolley cron may still be generating today’s slate.</Text>
          </View>
        ) : null}

        {picks.map((pick) => (
          <View key={pick.id} style={styles.pickCard}>
            <View style={styles.pickHead}>
              <Text style={styles.match}>{pick.home_team} vs {pick.away_team}</Text>
              <Text style={styles.confidence}>{formatPct(pick.confidence)}</Text>
            </View>
            <Text style={styles.league}>{pick.league}</Text>
            <View style={styles.marketWrap}>
              <Text style={styles.market}>{pick.market}</Text>
              <Text style={styles.selection}>{pick.selection}</Text>
            </View>
            <Text style={styles.reason}>{pick.rationale}</Text>
            <Text style={styles.foot}>Generated: {formatDateTime(pick.created_at)}</Text>
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
  metaLabel: { color: "#9ca3af", fontSize: 11 },
  metaValue: { color: "#fafafa", fontSize: 12, fontWeight: "600" },
  metaSub: { color: "#d1d5db", fontSize: 11, marginTop: 2 },
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
  pickCard: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#242424",
    borderRadius: 12,
    padding: 12,
    gap: 6,
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
  reason: { color: "#d1d5db", fontSize: 12, lineHeight: 17 },
  foot: { color: "#6b7280", fontSize: 10, marginTop: 2 },
});
