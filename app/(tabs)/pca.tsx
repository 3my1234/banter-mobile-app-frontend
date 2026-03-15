import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { ResizeMode, Video } from "expo-av";
import { Image as ExpoImage } from "expo-image";
import { Text } from "@/components/Themed";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { normalizeMediaUrl } from "@/lib/media";
import { getSocket } from "@/lib/socket";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";

type Sport = "SOCCER" | "BASKETBALL";

type Nominee = {
  id: string;
  name: string;
  team?: string | null;
  country?: string | null;
  position?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  voteCount: number;
  stats?: Record<string, number | string> | null;
};

type Category = {
  id: string;
  sport: Sport;
  season: string;
  categoryType: string;
  title: string;
  subtitle?: string | null;
  roundLabel?: string | null;
  description?: string | null;
  criteria?: string[] | Record<string, any> | null;
  isOpen: boolean;
  nominees: Nominee[];
};

const INTRO_SEEN_KEY = "banter_pca_intro_seen_v1";

const formatStatLabel = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const toImageViewUrl = (key: string) => `${API_ORIGIN}/api/public/images/view/${key.replace(/^\/+/, "")}`;

const extractPathFromUrl = (url: string) => {
  try {
    return new URL(url).pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
};

const resolveNomineeMediaUrls = (url?: string | null) => {
  if (!url) return undefined;
  const raw = url.trim();
  if (!raw) return undefined;

  const toResult = (primary?: string, fallback?: string) => {
    if (!primary && !fallback) return undefined;
    return { primary, fallback };
  };

  if (raw.includes("/api/public/images/view/")) {
    const key = raw.split("/api/public/images/view/")[1]?.replace(/^\/+/, "");
    const primary = key ? normalizeMediaUrl(key) || undefined : undefined;
    return toResult(primary, raw);
  }
  if (raw.includes("/api/images/view/")) {
    const publicView = raw.replace("/api/images/view/", "/api/public/images/view/");
    const key = publicView.split("/api/public/images/view/")[1]?.replace(/^\/+/, "");
    const primary = key ? normalizeMediaUrl(key) || undefined : undefined;
    return toResult(primary, publicView);
  }
  if (raw.startsWith("admin-uploads/") || raw.startsWith("user-uploads/")) {
    const fallback = toImageViewUrl(raw);
    const primary = normalizeMediaUrl(raw) || undefined;
    return toResult(primary, fallback);
  }

  if (/^https?:\/\/.+\.s3[.-].*amazonaws\.com\//i.test(raw)) {
    const key = extractPathFromUrl(raw);
    const fallback = key ? toImageViewUrl(key) : undefined;
    const primary = normalizeMediaUrl(raw) || undefined;
    return toResult(primary, fallback);
  }

  if (raw.includes("/admin-uploads/") || raw.startsWith("admin-uploads/")) {
    const key = raw.startsWith("admin-uploads/") ? raw : extractPathFromUrl(raw);
    const fallback = key ? toImageViewUrl(key) : undefined;
    const primary = normalizeMediaUrl(raw) || undefined;
    return toResult(primary, fallback);
  }

  return toResult(normalizeMediaUrl(raw) || raw);
};

export default function PCA() {
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [sport, setSport] = useState<Sport>("SOCCER");
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [voteBalance, setVoteBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingNomineeId, setSubmittingNomineeId] = useState<string | null>(null);
  const [voteAmountByNominee, setVoteAmountByNominee] = useState<Record<string, number>>({});
  const [showIntro, setShowIntro] = useState(false);
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const [mediaFallback, setMediaFallback] = useState<Record<string, boolean>>({});
  const [expandedImageUri, setExpandedImageUri] = useState<string | null>(null);

  const loadPca = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [categoryRes, meRes] = await Promise.allSettled([
        apiFetch(`/pca/categories?sport=${sport}&activeOnly=1`),
        apiFetch("/auth/me"),
      ]);

      if (categoryRes.status === "fulfilled") {
        const nextCategories = Array.isArray(categoryRes.value?.categories)
          ? categoryRes.value.categories
          : [];
        setCategories(nextCategories);
        if (nextCategories.length > 0) {
          setSelectedCategoryId((current) =>
            current && nextCategories.some((c: Category) => c.id === current)
              ? current
              : nextCategories[0].id
          );
        } else {
          setSelectedCategoryId(null);
        }
      } else {
        setLoadError(categoryRes.reason?.message || "PCA categories failed to load.");
      }

      if (meRes.status === "fulfilled") {
        setVoteBalance(meRes.value?.user?.voteBalance ?? 0);
      } else {
        setLoadError((prev) =>
          prev ? `${prev} Vote balance unavailable.` : "Vote balance unavailable."
        );
      }
    } catch (error: any) {
      setLoadError(error?.message || "Failed to load PCA.");
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const refreshPca = useCallback(async () => {
    try {
      setRefreshing(true);
      await loadPca();
    } finally {
      setRefreshing(false);
    }
  }, [loadPca]);

  useEffect(() => {
    loadPca();
  }, [loadPca]);

  useEffect(() => {
    let disposed = false;
    let socket: any;

    const setup = async () => {
      try {
        socket = await getSocket();
        if (disposed || !socket) return;
        socket.on(
          "pca.vote_update",
          (payload: { categoryId: string; nomineeId: string; nomineeVoteCount: number }) => {
            setCategories((prev) =>
              prev.map((category) => {
                if (category.id !== payload.categoryId) return category;
                return {
                  ...category,
                  nominees: category.nominees.map((nominee) =>
                    nominee.id === payload.nomineeId
                      ? { ...nominee, voteCount: payload.nomineeVoteCount }
                      : nominee
                  ),
                };
              })
            );
          }
        );
      } catch {
        // no-op
      }
    };

    setup();
    return () => {
      disposed = true;
      if (socket) {
        socket.off("pca.vote_update");
      }
    };
  }, []);

  useEffect(() => {
    const loadIntroState = async () => {
      const seen = await SecureStore.getItemAsync(INTRO_SEEN_KEY);
      if (!seen) {
        setShowIntro(true);
      }
    };
    loadIntroState();
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCategoryId) || null,
    [categories, selectedCategoryId]
  );

  const updateVoteAmount = (nomineeId: string, delta: number) => {
    setVoteAmountByNominee((prev) => {
      const current = prev[nomineeId] || 1;
      const next = Math.max(1, Math.min(1000, current + delta));
      return { ...prev, [nomineeId]: next };
    });
  };

  const castVote = async (nomineeId: string) => {
    if (!selectedCategory) return;
    const amount = voteAmountByNominee[nomineeId] || 1;
    if (amount > voteBalance) {
      Alert.alert("Insufficient votes", "Buy more votes in the Votes tab.");
      return;
    }
    try {
      setSubmittingNomineeId(nomineeId);
      const response = await apiFetch("/pca/vote", {
        method: "POST",
        body: JSON.stringify({
          categoryId: selectedCategory.id,
          nomineeId,
          votes: amount,
        }),
      });

      const nomineeVoteCount = response?.nominee?.voteCount;
      const remaining = response?.remainingVoteBalance;

      setCategories((prev) =>
        prev.map((category) => {
          if (category.id !== selectedCategory.id) return category;
          return {
            ...category,
            nominees: category.nominees.map((nominee) =>
              nominee.id === nomineeId
                ? {
                    ...nominee,
                    voteCount:
                      typeof nomineeVoteCount === "number"
                        ? nomineeVoteCount
                        : nominee.voteCount + amount,
                  }
                : nominee
            ),
          };
        })
      );

      if (typeof remaining === "number") {
        setVoteBalance(remaining);
      } else {
        setVoteBalance((prev) => Math.max(0, prev - amount));
      }

      Alert.alert("Vote submitted", "Your PCA vote was counted.");
    } catch (error: any) {
      Alert.alert("Vote failed", error?.message || "Failed to submit vote.");
    } finally {
      setSubmittingNomineeId(null);
    }
  };

  const dismissIntro = async () => {
    await SecureStore.setItemAsync(INTRO_SEEN_KEY, "1");
    setShowIntro(false);
  };

  const renderNominee = ({ item }: { item: Nominee }) => {
    const amount = voteAmountByNominee[item.id] || 1;
    const stats = Object.entries(item.stats || {}).filter(([, value]) => value !== null && value !== undefined);
    const imageSources = resolveNomineeMediaUrls(item.imageUrl || undefined);
    const videoSources = resolveNomineeMediaUrls(item.videoUrl || undefined);
    const imageFallbackKey = `${item.id}:image:fallback`;
    const videoFallbackKey = `${item.id}:video:fallback`;
    const imageUri = mediaFallback[imageFallbackKey]
      ? imageSources?.fallback || imageSources?.primary
      : imageSources?.primary || imageSources?.fallback;
    const videoUri = mediaFallback[videoFallbackKey]
      ? videoSources?.fallback || videoSources?.primary
      : videoSources?.primary || videoSources?.fallback;
    const imageError = mediaErrors[`${item.id}:image`];
    const videoError = mediaErrors[`${item.id}:video`];
    const mediaError = imageError || videoError;
    const mediaCount = (imageUri ? 1 : 0) + (videoUri ? 1 : 0);

    return (
      <View style={styles.nomineeCard}>
        <View style={styles.nomineeTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nomineeName}>{item.name}</Text>
            <Text style={styles.nomineeMeta}>
              {[item.team, item.position, item.country].filter(Boolean).join(" - ") || "Nominee"}
            </Text>
          </View>
          <Text style={styles.nomineeVotes}>{item.voteCount.toLocaleString()} votes</Text>
        </View>

        {imageUri || videoUri ? (
          <View style={styles.mediaGrid}>
            {imageUri ? (
              <Pressable onPress={() => setExpandedImageUri(imageUri)} style={styles.mediaTap}>
                <ExpoImage
                  source={{ uri: imageUri }}
                  style={[styles.mediaCard, mediaCount === 1 && styles.mediaCardSingle]}
                  contentFit="cover"
                  transition={150}
                  onError={(event) => {
                    if (!mediaFallback[imageFallbackKey] && imageSources?.fallback) {
                      setMediaFallback((prev) => ({ ...prev, [imageFallbackKey]: true }));
                      return;
                    }
                    const message = (event as any)?.error || "Image failed to load";
                    setMediaErrors((prev) => ({ ...prev, [`${item.id}:image`]: String(message) }));
                  }}
                />
              </Pressable>
            ) : null}
            {videoUri ? (
              <Video
                source={{ uri: videoUri }}
                style={[styles.mediaCard, mediaCount === 1 && styles.mediaCardSingle]}
                useNativeControls
                shouldPlay={false}
                resizeMode={ResizeMode.COVER}
                isLooping
                onError={(message) => {
                  if (!mediaFallback[videoFallbackKey] && videoSources?.fallback) {
                    setMediaFallback((prev) => ({ ...prev, [videoFallbackKey]: true }));
                    return;
                  }
                  setMediaErrors((prev) => ({ ...prev, [`${item.id}:video`]: String(message || "Video failed to load") }));
                }}
              />
            ) : null}
            {mediaError ? <Text style={styles.mediaError}>Media failed to load</Text> : null}
          </View>
        ) : (
          <Text style={styles.mediaError}>No media attached for this nominee</Text>
        )}

        {stats.length > 0 ? (
          <View style={styles.statsWrap}>
            {stats.map(([key, value]) => (
              <View key={key} style={styles.statChip}>
                <Text style={styles.statText}>
                  {formatStatLabel(key)}: {String(value)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.voteRow}>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => updateVoteAmount(item.id, -1)}>
              <Text style={styles.stepText}>-</Text>
            </Pressable>
            <Text style={styles.voteAmount}>{amount}</Text>
            <Pressable style={styles.stepBtn} onPress={() => updateVoteAmount(item.id, 1)}>
              <Text style={styles.stepText}>+</Text>
            </Pressable>
          </View>

          <TouchableOpacity
            style={[styles.voteBtn, submittingNomineeId === item.id && styles.voteBtnDisabled]}
            onPress={() => castVote(item.id)}
            disabled={submittingNomineeId === item.id || !selectedCategory?.isOpen}
          >
            <Text style={styles.voteBtnText}>
              {submittingNomineeId === item.id ? "Submitting..." : "Vote"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <CenteredHeartbeatLoader
          visible={loading || refreshing}
          text={loading ? "Loading PCA..." : "Refreshing..."}
        />

        <View style={styles.header}>
          <View>
            <Text style={styles.pcaTitle}>People's Choice Award</Text>
            <Text style={styles.pcaSubtitle}>
              Finally giving fans worldwide the chance to vote their favorite players for deserved awards.
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowIntro(true)}>
            <Text style={styles.help}>How it works</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.balance}>Available votes: {voteBalance}</Text>

        <View style={styles.sportSwitch}>
          {(["SOCCER", "BASKETBALL"] as Sport[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.sportChip, sport === s && styles.sportChipActive]}
              onPress={() => setSport(s)}
            >
              <Text style={[styles.sportText, sport === s && styles.sportTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryTabs}>
          {categories.map((category) => (
            <TouchableOpacity
              key={category.id}
              style={[
                styles.categoryTab,
                selectedCategoryId === category.id && styles.categoryTabActive,
              ]}
              onPress={() => setSelectedCategoryId(category.id)}
            >
              <Text style={styles.categoryTabTitle}>{category.title}</Text>
              {!!category.roundLabel && <Text style={styles.categoryTabSub}>{category.roundLabel}</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {!loading && loadError ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity onPress={() => void loadPca()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!loading && !selectedCategory ? <Text style={styles.loading}>No active category yet.</Text> : null}

        {selectedCategory ? (
          <>
            <View style={styles.categoryHeader}>
              <Text style={styles.categoryTitle}>{selectedCategory.title}</Text>
              <Text style={styles.categoryState}>
                {selectedCategory.isOpen ? "Voting open" : "Voting closed"}
              </Text>
            </View>
            {!!selectedCategory.description && (
              <Text style={styles.categoryDescription}>{selectedCategory.description}</Text>
            )}
            {!!selectedCategory.subtitle && <Text style={styles.categorySub}>{selectedCategory.subtitle}</Text>}

            <FlatList
              data={selectedCategory.nominees}
              keyExtractor={(item) => item.id}
              renderItem={renderNominee}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refreshPca}
                  tintColor="transparent"
                  colors={["transparent"]}
                  progressBackgroundColor="transparent"
                />
              }
            />
          </>
        ) : null}
      </View>

      <Modal visible={showIntro} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Welcome to PCA</Text>
            <Text style={styles.modalText}>
              PCA lets the community pick winners based on performance stats and moments of the season.
            </Text>
            <Text style={styles.modalText}>
              Buy votes in the Votes tab, then cast them for your preferred nominee. You can vote multiple
              times.
            </Text>
            <Text style={styles.modalText}>
              Vote proceeds help Banter fund winner rewards and season recognition events.
            </Text>
            <TouchableOpacity style={styles.modalBtn} onPress={dismissIntro}>
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(expandedImageUri)} transparent animationType="fade">
        <View style={styles.previewBackdrop}>
          <Pressable style={styles.previewClose} onPress={() => setExpandedImageUri(null)}>
            <Text style={styles.previewCloseText}>×</Text>
          </Pressable>
          <Pressable style={styles.previewBody} onPress={() => setExpandedImageUri(null)}>
            {expandedImageUri ? (
              <ExpoImage
                source={{ uri: expandedImageUri }}
                style={styles.previewImage}
                contentFit="contain"
                transition={120}
              />
            ) : null}
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 14, paddingTop: 10 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    minHeight: 24,
  },
  pcaTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  pcaSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 4, maxWidth: 220 },
  help: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
  balance: { color: colors.text, marginTop: 8, fontWeight: "700" },
  sportSwitch: { flexDirection: "row", gap: 8, marginTop: 12 },
  sportChip: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sportChipActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.15)" },
  sportText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  sportTextActive: { color: "#ff6b35" },
  categoryTabs: { marginTop: 12, maxHeight: 72 },
  categoryTab: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    minWidth: 150,
  },
  categoryTabActive: { borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.1)" },
  categoryTabTitle: { color: colors.text, fontWeight: "700", fontSize: 12 },
  categoryTabSub: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  loading: { color: colors.textMuted, marginTop: 14 },
  errorWrap: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#ff6b35", flex: 1, fontSize: 12 },
  retryText: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
  categoryHeader: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  categoryTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  categoryState: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
  categoryDescription: { color: colors.textSoft, marginTop: 8, fontSize: 12, lineHeight: 18 },
  categorySub: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
  listContent: { paddingTop: 10, paddingBottom: 18, gap: 10 },
  nomineeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  nomineeTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nomineeName: { color: colors.text, fontWeight: "700", fontSize: 14 },
  nomineeMeta: { color: colors.textMuted, marginTop: 3, fontSize: 11 },
  nomineeVotes: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
  mediaGrid: { flexDirection: "row", gap: 8 },
  mediaTap: { flex: 1 },
  mediaCard: {
    flex: 1,
    minHeight: 160,
    maxHeight: 220,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaCardSingle: {
    flex: 0,
    width: "100%",
  },
  mediaError: { color: "#fca5a5", fontSize: 11 },
  statsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  statText: { color: colors.textSoft, fontSize: 11 },
  voteRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    overflow: "hidden",
  },
  stepBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  stepText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  voteAmount: { color: colors.text, width: 40, textAlign: "center", fontWeight: "700" },
  voteBtn: {
    backgroundColor: "#ff6b35",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  voteBtnDisabled: { opacity: 0.6 },
  voteBtnText: { color: "#0d0d0d", fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: { width: "100%", backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  modalText: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  modalBtn: {
    marginTop: 8,
    backgroundColor: "#ff6b35",
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: "center",
  },
  modalBtnText: { color: "#111", fontWeight: "700" },
  previewBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
  },
  previewClose: {
    position: "absolute",
    top: 46,
    right: 18,
    zIndex: 3,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  previewCloseText: { color: colors.text, fontSize: 24, lineHeight: 24 },
  previewBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  previewImage: { width: "100%", height: "82%" },
});
