import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View as RNView,
} from "react-native";
import { Platform, ToastAndroid, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { Text, View } from "@/components/Themed";
import { Image as ExpoImage } from "expo-image";
import { apiFetch } from "@/lib/api";
import { normalizeMediaUrl, pickMedia, presignUpload, uploadToS3 } from "@/lib/media";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useEmbeddedSolanaWallet, usePrivy } from "@privy-io/expo";
import { disconnectSocket } from "@/lib/socket";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { useThemePreference } from "@/components/theme";
import { sendEmbeddedSolanaUsdc } from "@/lib/privySolana";

type Session = { token: string; email?: string };

export default function ProfileScreen() {
  const router = useRouter();
  const { logout: privyLogout } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();
  const { resolvedTheme, setPreference } = useThemePreference();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [showAvatar, setShowAvatar] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, any> | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [profileTab, setProfileTab] = useState<"posts" | "banter" | "comments">("posts");
  const [syncingWallets, setSyncingWallets] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [walletsSynced, setWalletsSynced] = useState(false);
  const [showPointsDetails, setShowPointsDetails] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileLocked, setProfileLocked] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawSending, setWithdrawSending] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const movementExplorerBase =
    process.env.EXPO_PUBLIC_MOVEMENT_EXPLORER_BASE ??
    "https://explorer.movementlabs.xyz/tx/";
  const isDark = resolvedTheme === "dark";
  const screenBg = isDark ? "#0d0d0d" : "#e0e0e0";
  const textPrimaryStyle = { color: isDark ? "#fff" : "#111" };
  const textSoftStyle = { color: isDark ? "#e5e7eb" : "#374151" };
  const textMutedStyle = { color: isDark ? "#9ca3af" : "#4b5563" };
  const cardStyle = {
    backgroundColor: isDark ? "#111" : "#f7f7f7",
    borderColor: isDark ? "#1f1f1f" : "#d1d5db",
    borderWidth: 1,
  };
  const solanaUsdcMint =
    process.env.EXPO_PUBLIC_SOLANA_USDC_MINT ??
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const detectMediaType = (uri?: string | null, fallback?: string | null) => {
    if (fallback) return fallback;
    if (!uri) return undefined;
    const lower = uri.toLowerCase();
    if (lower.match(/\.(mp4|mov|m4v|webm|m3u8)$/)) return "video";
    return "image";
  };

  const getMediaItems = (
    rawMediaItems: unknown,
    fallbackUrl?: string | null,
    fallbackType?: string | null
  ) => {
    const normalized = Array.isArray(rawMediaItems)
      ? rawMediaItems
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const uri = normalizeMediaUrl((item as any).url);
            const type = detectMediaType(uri, (item as any).type || null);
            if (!uri || !type) return null;
            return { uri, type };
          })
          .filter((item): item is { uri: string; type: string } => !!item)
      : [];

    if (normalized.length) return normalized;
    const uri = normalizeMediaUrl(fallbackUrl);
    const type = detectMediaType(uri, fallbackType || null);
    if (!uri || !type) return [];
    return [{ uri, type }];
  };

  useEffect(() => {
    const loadSession = async () => {
      const raw = await SecureStore.getItemAsync("banter_session");
      if (!raw) {
        setSessionLoaded(true);
        setLoading(false);
        return;
      }
      const parsed = JSON.parse(raw) as Session;
      setSession(parsed);
      setSessionLoaded(true);
    };
    loadSession();
  }, []);

  useEffect(() => {
    if (sessionLoaded && !session?.token) {
      router.replace("/(auth)/login");
    }
  }, [sessionLoaded, session?.token, router]);

  const showToast = (message: string) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert("Notice", message);
    }
  };

  const fetchMe = async () => {
    if (!session?.token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await apiFetch("/auth/me", undefined, true);
      setMe(data.user || data);
    } catch (e: any) {
      showToast(e.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const formatTokenAmount = (amount?: string, decimals?: number) => {
    if (!amount) return "-";
    const dec = typeof decimals === "number" ? decimals : 6;
    const num = Number(amount);
    if (!Number.isFinite(num)) return "-";
    const value = num / Math.pow(10, dec);
    return value.toLocaleString(undefined, {
      minimumFractionDigits: dec >= 6 ? 2 : 0,
      maximumFractionDigits: dec >= 6 ? 6 : 2,
    });
  };

  const formatPoints = (raw?: string | number) => {
    const numeric = Number(raw || 0);
    if (!Number.isFinite(numeric)) return "0";
    return numeric.toLocaleString();
  };

  const normalizeTransactions = (rawTransactions: any[]) => {
    const deduped: any[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rawTransactions.length; i += 1) {
      const item = rawTransactions[i] || {};
      const key = (item.txHash || item.id || `${item.tokenSymbol}-${item.createdAt}-${i}`).toString();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    return deduped.filter((item) => {
      const symbol = (item?.tokenSymbol || "").toString().toUpperCase();
      return symbol !== "USDC.E" && symbol !== "MOVE";
    });
  };

  const fetchWalletData = async () => {
    try {
      const data = await apiFetch("/wallet/balances");
      setBalances(data?.balances || null);

      setTransactionsLoading(true);
      const tx = await apiFetch("/wallet/transactions?limit=20&page=1");
      setTransactions(normalizeTransactions(tx?.transactions || []));

      if (!walletsSynced && data?.wallets?.length) {
        setSyncingWallets(true);
        void (async () => {
          try {
            await Promise.allSettled(
              data.wallets.map((wallet: any) =>
                apiFetch(`/wallet/sync/${wallet.id}`, { method: "POST" })
              )
            );
            const [refreshedBalances, refreshedTransactions] = await Promise.allSettled([
              apiFetch("/wallet/balances"),
              apiFetch("/wallet/transactions?limit=20&page=1&includeIndexer=1"),
            ]);

            if (refreshedBalances.status === "fulfilled") {
              setBalances(refreshedBalances.value?.balances || null);
            }
            if (refreshedTransactions.status === "fulfilled") {
              setTransactions(normalizeTransactions(refreshedTransactions.value?.transactions || []));
            }
            setWalletsSynced(true);
          } finally {
            setSyncingWallets(false);
          }
        })();
      }
    } catch (e: any) {
      showToast(e.message || "Failed to sync wallet");
    } finally {
      setTransactionsLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, [session]);

  useFocusEffect(
    React.useCallback(() => {
      if (sessionLoaded) {
        fetchMe();
        fetchWalletData();
      }
    }, [sessionLoaded, session?.token])
  );

  useEffect(() => {
    const fetchPosts = async () => {
      if (!me?.id) return;
      try {
        const data = await apiFetch(`/users/${me.id}/posts`);
      setUserPosts(data.posts || []);
      } catch {
        setUserPosts([]);
      }
    };
    fetchPosts();
  }, [me]);

  useEffect(() => {
    setProfileLocked(!!me?.profileLocked);
  }, [me?.profileLocked]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await Promise.all([fetchMe(), fetchWalletData()]);
    } finally {
      setRefreshing(false);
    }
  };

  const logout = async () => {
    try {
      await privyLogout();
    } catch {
      // Keep local logout path even if Privy session teardown fails.
    }
    try {
      await WebBrowser.dismissAuthSession();
    } catch {
      // ignore
    }
    await SecureStore.deleteItemAsync("banter_session");
    await SecureStore.deleteItemAsync("banter_pending_registration");
    disconnectSocket();
    setSession(null);
    setMe(null);
    router.replace("/(auth)/login");
  };

  const updateProfileLock = async (nextLocked: boolean) => {
    setProfileLocked(nextLocked);
    setMe((prev: any) => (prev ? { ...prev, profileLocked: nextLocked } : prev));
    try {
      await apiFetch(
        "/auth/me",
        {
          method: "PATCH",
          body: JSON.stringify({ profileLocked: nextLocked }),
        },
        true
      );
    } catch (e: any) {
      setProfileLocked((prev) => !prev);
      setMe((prev: any) =>
        prev ? { ...prev, profileLocked: !nextLocked } : prev
      );
      showToast(e?.message || "Failed to update profile lock");
    }
  };

  const toggleTheme = async (useDark: boolean) => {
    await setPreference(useDark ? "dark" : "light");
  };

  const uploadAvatar = async () => {
    try {
      setUploading(true);
      setError(null);
      const picked = await pickMedia("image");
      if (!picked) return;

      const presign = await presignUpload(
        picked.fileName,
        picked.mimeType,
        "profile"
      );
      await uploadToS3(presign.uploadUrl, picked.uri, picked.mimeType);

      const res = await apiFetch(
        "/images/save-profile-picture",
        {
          method: "POST",
          body: JSON.stringify({ imageUrl: presign.viewUrl }),
        },
        true
      );

      const nextAvatar = normalizeMediaUrl(res.avatarUrl || presign.viewUrl);
      setMe((prev: any) => ({
        ...(prev || {}),
        avatarUrl: nextAvatar,
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const formatAddress = (value?: string) => {
    if (!value) return "-";
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  };

  const openExplorer = async (txHash?: string | null) => {
    if (!txHash) return;
    const url = `${movementExplorerBase}${txHash}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      showToast("Unable to open explorer");
    }
  };

  const handleCopy = async (label: string, value?: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopiedWallet(label);
    setTimeout(() => setCopiedWallet(null), 1500);
  };

  const handleWithdrawUsdc = async () => {
    const toAddress = withdrawAddress.trim();
    const amount = Number(withdrawAmount);
    if (!toAddress) {
      showToast("Enter the destination address.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid USDC amount.");
      return;
    }
    try {
      setWithdrawSending(true);
      setWithdrawError(null);
      const result = await sendEmbeddedSolanaUsdc({
        walletState: solanaWallet,
        toAddress,
        amount,
        tokenMint: solanaUsdcMint,
        decimals: usdcBalance?.decimals ?? 6,
      });
      if (result?.signature) {
        showToast("USDC withdrawal sent.");
      } else {
        showToast("Withdrawal submitted.");
      }
      setWithdrawOpen(false);
      setWithdrawAddress("");
      setWithdrawAmount("");
      await fetchWalletData();
    } catch (e: any) {
      const message = e?.message || "Unable to send USDC.";
      setWithdrawError(message);
      showToast(message);
    } finally {
      setWithdrawSending(false);
    }
  };

  const Row = ({ label, value }: { label: string; value?: string }) => (
    <View style={styles.row}>
      <Text style={[styles.label, textMutedStyle]}>{label}</Text>
      <Text style={[styles.value, textSoftStyle]}>{value ?? "-"}</Text>
    </View>
  );

  const WalletRow = ({ label, value }: { label: string; value?: string }) => (
    <Pressable style={styles.walletRow} onPress={() => handleCopy(label, value)}>
      <View style={styles.walletInfo}>
        <Text style={[styles.walletLabel, textMutedStyle]}>{label}</Text>
        <Text style={[styles.walletValue, textSoftStyle]} numberOfLines={1}>
          {formatAddress(value)}
        </Text>
      </View>
      <FontAwesome name="copy" size={14} color="#9ca3af" />
    </Pressable>
  );

  if (!sessionLoaded) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <CenteredHeartbeatLoader visible text="Loading your profile..." />
      </SafeAreaView>
    );
  }

  if (sessionLoaded && !session?.token) {
    return (
      <View style={styles.center}>
        <Text style={[styles.title, textPrimaryStyle]}>You're logged out</Text>
        <Text style={[styles.muted, textMutedStyle]}>Redirecting to login…</Text>
      </View>
    );
  }

  const bannerUrl = normalizeMediaUrl(me?.bannerUrl);
  const avatarUrl = normalizeMediaUrl(me?.avatarUrl);
  const displayName = me?.displayName || "User";
  const username = me?.username ? `@${me.username}` : "@user";
  const bio = me?.bio || "No bio yet.";
  const solBalance = balances?.SOL;
  const usdcBalance = balances?.USDC;
  const rolFromWallet = balances?.ROL;
  const rolFallbackRaw = String(me?.rolBalanceRaw || "0");
  const banterPointsRaw = String(me?.banterPointsRaw || "0");
  const rolBalance =
    rolFromWallet && String(rolFromWallet.balance || "0") !== "0"
      ? rolFromWallet
      : { balance: rolFallbackRaw, decimals: 8 };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: screenBg }]} edges={["top"]}>
      <CenteredHeartbeatLoader visible={loading || refreshing} text={loading ? "Loading profile..." : "Refreshing..."} />
      <ScrollView
        style={[styles.container, { backgroundColor: screenBg }]}
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
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.bannerWrap} onPress={() => bannerUrl && setShowBanner(true)}>
          {bannerUrl ? (
            <ExpoImage
              source={{ uri: bannerUrl }}
              style={styles.banner}
              contentFit="cover"
              transition={180}
              cachePolicy="memory-disk"
            />
          ) : (
            <RNView style={styles.bannerPlaceholder} />
          )}
        </Pressable>

        <RNView style={styles.profileHeader}>
          <Pressable onPress={() => avatarUrl && setShowAvatar(true)}>
            {avatarUrl ? (
              <ExpoImage
                source={{ uri: avatarUrl }}
                style={styles.avatarLarge}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
              />
            ) : (
              <RNView style={styles.avatarLarge} />
            )}
          </Pressable>
          <RNView style={styles.profileActions}>
            <Pressable style={styles.editBtn} onPress={() => router.push("/edit-profile")}>
              <Text style={styles.editBtnText}>Edit profile</Text>
            </Pressable>
            <Pressable
              style={styles.settingsBtn}
              onPress={() => setSettingsOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name="cog" size={16} color="#0d0d0d" />
            </Pressable>
          </RNView>
        </RNView>

        <Text style={[styles.displayName, textPrimaryStyle]}>{displayName}</Text>
        <Text style={[styles.username, textMutedStyle]}>{username}</Text>
        <Text style={[styles.bio, textSoftStyle]}>{bio}</Text>

        <View style={[styles.card, cardStyle]}>
          <View style={styles.walletHeader}>
            <Text style={[styles.sectionTitle, textPrimaryStyle]}>Wallets</Text>
            {copiedWallet ? (
              <Text style={[styles.copiedText, textMutedStyle]}>Copied {copiedWallet}</Text>
            ) : null}
          </View>
          <WalletRow label="Solana" value={me?.solanaAddress} />
        </View>

        <View style={[styles.card, cardStyle]}>
          <Text style={[styles.sectionTitle, textPrimaryStyle]}>Balances</Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, textMutedStyle]}>SOL (gas)</Text>
            <Text style={[styles.balanceValue, textSoftStyle]}>
              {solBalance
                ? `${formatTokenAmount(solBalance.balance, solBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, textMutedStyle]}>USDC (Solana)</Text>
            <Text style={[styles.balanceValue, textSoftStyle]}>
              {usdcBalance
                ? `${formatTokenAmount(usdcBalance.balance, usdcBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          <Pressable
            style={styles.withdrawButton}
            onPress={() => setWithdrawOpen(true)}
            disabled={withdrawSending}
          >
            <Text style={styles.withdrawButtonText}>Withdraw USDC (Solana)</Text>
          </Pressable>
          <Text style={[styles.withdrawHint, textMutedStyle]}>
            Requires a tiny SOL fee in your in-app wallet.
          </Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.balanceLabel, textMutedStyle]}>ROL</Text>
            <Text style={[styles.balanceValue, textSoftStyle]}>
              {rolBalance
                ? `${formatTokenAmount(rolBalance.balance, rolBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          {syncingWallets ? (
            <Text style={[styles.muted, textMutedStyle]}>Syncing wallets...</Text>
          ) : null}
        </View>

        <View style={[styles.card, cardStyle]}>
          <View style={styles.pointsHeaderRow}>
            <View style={styles.pointsHeaderCopy}>
              <Text style={[styles.sectionTitle, textPrimaryStyle]}>Banter Points</Text>
              <Text style={[styles.pointsValue, textPrimaryStyle]}>{formatPoints(banterPointsRaw)} pts</Text>
              <Text style={[styles.pointsSub, textMutedStyle]}>
                Your Banter Points track real activity in the app and can help determine your share in a future ROL airdrop.
              </Text>
            </View>
            <Pressable
              onPress={() => setShowPointsDetails((current) => !current)}
              style={styles.pointsToggle}
            >
              <Text style={styles.pointsToggleText}>
                {showPointsDetails ? "Hide" : "View more"}
              </Text>
            </Pressable>
          </View>

          {showPointsDetails ? (
            <View style={styles.pointsDetailsWrap}>
              <Text style={[styles.pointsDetailLead, textMutedStyle]}>
                Points are stored in your account, not in your wallet. When the airdrop opens, eligible activity and point history will be used to calculate claim amounts.
              </Text>

              <View style={styles.pointsRule}>
                <Text style={[styles.pointsRuleTitle, textPrimaryStyle]}>Joined early</Text>
                <Text style={styles.pointsRuleValue}>+500</Text>
              </View>
              <Text style={[styles.pointsRuleBody, textMutedStyle]}>
                One-time welcome bonus for users who joined during the early access period.
              </Text>

              <View style={styles.pointsRule}>
                <Text style={[styles.pointsRuleTitle, textPrimaryStyle]}>Daily check-in</Text>
                <Text style={styles.pointsRuleValue}>+10</Text>
              </View>
              <Text style={[styles.pointsRuleBody, textMutedStyle]}>
                Awarded once per day when you sign in and stay active.
              </Text>

              <View style={styles.pointsRule}>
                <Text style={[styles.pointsRuleTitle, textPrimaryStyle]}>PCA participation</Text>
                <Text style={styles.pointsRuleValue}>+5</Text>
              </View>
              <Text style={[styles.pointsRuleBody, textMutedStyle]}>
                Earned the first time you vote in PCA on a given day while a campaign is active.
              </Text>

              <View style={styles.pointsRule}>
                <Text style={[styles.pointsRuleTitle, textPrimaryStyle]}>First Rolley stake</Text>
                <Text style={styles.pointsRuleValue}>+75</Text>
              </View>
              <Text style={[styles.pointsRuleBody, textMutedStyle]}>
                One-time bonus for completing your first Rolley stake.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, cardStyle]}>
          <Text style={[styles.sectionTitle, textPrimaryStyle]}>Transactions</Text>
          {transactionsLoading ? (
            <View style={styles.txLoading}>
              <ActivityIndicator color="#ff6b35" />
              <Text style={[styles.muted, textMutedStyle]}>Loading transactions...</Text>
            </View>
          ) : transactions.length === 0 ? (
            <Text style={[styles.muted, textMutedStyle]}>No transactions yet.</Text>
          ) : (
            <ScrollView
              style={styles.txList}
              contentContainerStyle={styles.txListContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {transactions.map((tx, index) => {
                const rawType = (tx.txType || tx.type || "").toString().toUpperCase();
                const isDeposit =
                  rawType.includes("DEPOSIT") ||
                  rawType.includes("CREDIT") ||
                  rawType.includes("RECEIVE");
                const icon = isDeposit ? "arrow-down" : "arrow-up";
                const symbol = (tx.tokenSymbol || "TOKEN").toString().toUpperCase();
                const tokenDecimals =
                  tx.metadata?.decimals ??
                  (symbol === "MOVE" ? 8 : symbol === "USDC.E" || symbol === "USDC" ? 6 : 6);
                const amount = formatTokenAmount(tx.amount, tokenDecimals);
                const canOpen = !!tx.txHash;
                const txKey = (tx.txHash || tx.id || `${symbol}-${tx.createdAt}-${index}`).toString();
                const title =
                  rawType.includes("TRANSFER") ||
                  rawType.includes("WITHDRAW") ||
                  rawType.includes("DEBIT")
                    ? "Transfer"
                    : isDeposit
                    ? "Deposit"
                    : "Activity";
                return (
                  <Pressable
                    key={txKey}
                    style={styles.txRow}
                    onPress={() => (canOpen ? openExplorer(tx.txHash) : undefined)}
                    disabled={!canOpen}
                  >
                    <RNView style={[styles.txIconWrap, isDeposit ? styles.txIn : styles.txOut]}>
                      <FontAwesome name={icon} size={12} color="#0d0d0d" />
                    </RNView>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.txTitle, textPrimaryStyle]}>{title}</Text>
                      <Text style={[styles.txMeta, textMutedStyle]} numberOfLines={1}>
                        {tx.txHash ? tx.txHash.slice(0, 12) + "..." : "On-chain"}
                      </Text>
                    </View>
                    <RNView style={styles.txRight}>
                      <Text style={[styles.txAmount, textSoftStyle]}>
                        {isDeposit ? "+" : "-"} {amount} {symbol}
                      </Text>
                      {canOpen ? (
                        <Pressable
                          onPress={() => openExplorer(tx.txHash)}
                          style={styles.txLink}
                          hitSlop={8}
                        >
                          <FontAwesome name="external-link" size={12} color="#9ca3af" />
                        </Pressable>
                      ) : null}
                    </RNView>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        <View style={[styles.card, cardStyle]}>
          <Text style={[styles.sectionTitle, textPrimaryStyle]}>Your activity</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.profileTabsRow}
          >
            <Pressable
              style={[styles.profileTab, profileTab === "posts" && styles.profileTabActive]}
              onPress={() => setProfileTab("posts")}
            >
              <Text
                style={[
                  styles.profileTabText,
                  profileTab === "posts" && styles.profileTabTextActive,
                ]}
              >
                Posts
              </Text>
            </Pressable>
            <Pressable
              style={[styles.profileTab, profileTab === "banter" && styles.profileTabActive]}
              onPress={() => setProfileTab("banter")}
            >
              <Text
                style={[
                  styles.profileTabText,
                  profileTab === "banter" && styles.profileTabTextActive,
                ]}
              >
                Banter
              </Text>
            </Pressable>
            <Pressable
              style={[styles.profileTab, profileTab === "comments" && styles.profileTabActive]}
              onPress={() => setProfileTab("comments")}
            >
              <Text
                style={[
                  styles.profileTabText,
                  profileTab === "comments" && styles.profileTabTextActive,
                ]}
              >
                Comments/Replies
              </Text>
            </Pressable>
          </ScrollView>

          {profileTab === "comments" ? (
            <Text style={[styles.muted, textMutedStyle]}>Your comments and replies will appear here.</Text>
          ) : (
            (() => {
              const filtered =
                profileTab === "posts"
                  ? userPosts.filter((p) => !p.isRoast)
                  : userPosts.filter((p) => p.isRoast);
              if (filtered.length === 0) {
                return (
                  <Text style={[styles.muted, textMutedStyle]}>
                    {profileTab === "posts"
                      ? "Posts will appear here."
                      : "Banter will appear here."}
                  </Text>
                );
              }
              return filtered.map((post) => {
                const mediaItems = getMediaItems(post.mediaItems, post.mediaUrl, post.mediaType);
                const mediaUrl = mediaItems[0]?.uri;
                const mediaType = mediaItems[0]?.type;
                return (
                  <Pressable
                    key={post.id}
                    style={styles.postRow}
                    onPress={() => router.push(`/post/${post.id}`)}
                  >
                    {mediaUrl ? (
                      <RNView style={styles.postMediaWrap}>
                        <ExpoImage
                          source={{ uri: mediaUrl }}
                          style={styles.postMedia}
                          contentFit="cover"
                          transition={120}
                          cachePolicy="memory-disk"
                        />
                      {mediaItems.length > 1 ? (
                        <RNView style={styles.postMediaBadge}>
                          <Text style={styles.postMediaBadgeText}>{mediaItems.length}</Text>
                        </RNView>
                      ) : mediaType === "video" ? (
                        <RNView style={styles.postMediaBadge}>
                          <FontAwesome name="play" size={10} color="#fff" />
                        </RNView>
                        ) : null}
                      </RNView>
                    ) : (
                      <RNView style={styles.postMediaPlaceholder}>
                        <FontAwesome name="file-text-o" size={14} color="#6b7280" />
                      </RNView>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.postText, textSoftStyle]} numberOfLines={2}>
                        {post.content || "No text"}
                      </Text>
                    </View>
                  </Pressable>
                );
              });
            })()
          )}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showAvatar} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAvatar(false)}>
          {avatarUrl ? (
            <ExpoImage
              source={{ uri: avatarUrl }}
              style={styles.modalImage}
              contentFit="contain"
              transition={180}
              cachePolicy="memory-disk"
            />
          ) : null}
        </Pressable>
      </Modal>

      <Modal visible={showBanner} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowBanner(false)}>
          {bannerUrl ? (
            <ExpoImage
              source={{ uri: bannerUrl }}
              style={styles.modalImage}
              contentFit="contain"
              transition={180}
              cachePolicy="memory-disk"
            />
          ) : null}
        </Pressable>
      </Modal>

      <Modal visible={settingsOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsOpen(false)} />
        <RNView style={styles.settingsSheet}>
          <Text style={styles.sectionTitle}>Settings</Text>

          <RNView style={styles.settingsRow}>
            <RNView>
              <Text style={styles.settingsLabel}>Lock profile</Text>
              <Text style={styles.settingsSub}>
                Hide your posts and banter from other users.
              </Text>
            </RNView>
            <Switch
              value={profileLocked}
              onValueChange={updateProfileLock}
              thumbColor={profileLocked ? "#ff6b35" : "#9ca3af"}
              trackColor={{ false: "#2a2a2a", true: "rgba(255,107,53,0.35)" }}
            />
          </RNView>

          <RNView style={styles.settingsRow}>
            <RNView>
              <Text style={styles.settingsLabel}>Theme</Text>
              <Text style={styles.settingsSub}>
                {isDark ? "Dark mode" : "Light mode"}
              </Text>
            </RNView>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              thumbColor={isDark ? "#ff6b35" : "#9ca3af"}
              trackColor={{ false: "#2a2a2a", true: "rgba(255,107,53,0.35)" }}
            />
          </RNView>
        </RNView>
      </Modal>

      <Modal visible={withdrawOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setWithdrawOpen(false)} />
        <RNView style={styles.withdrawSheet}>
          <Text style={styles.sectionTitle}>Withdraw USDC (Solana)</Text>
          <Text style={styles.withdrawLabel}>Destination address</Text>
          <TextInput
            style={styles.withdrawInput}
            value={withdrawAddress}
            onChangeText={setWithdrawAddress}
            placeholder="Solana address"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.withdrawLabel}>Amount (USDC)</Text>
          <TextInput
            style={styles.withdrawInput}
            value={withdrawAmount}
            onChangeText={setWithdrawAmount}
            placeholder="0.00"
            placeholderTextColor="#6b7280"
            keyboardType="decimal-pad"
          />
          {withdrawError ? <Text style={styles.error}>{withdrawError}</Text> : null}
          <RNView style={styles.withdrawActions}>
            <Pressable style={styles.withdrawCancel} onPress={() => setWithdrawOpen(false)}>
              <Text style={styles.withdrawCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.withdrawSubmit}
              onPress={handleWithdrawUsdc}
              disabled={withdrawSending}
            >
              {withdrawSending ? (
                <ActivityIndicator color="#0d0d0d" />
              ) : (
                <Text style={styles.withdrawSubmitText}>Send USDC</Text>
              )}
            </Pressable>
          </RNView>
        </RNView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#fff", marginBottom: 8 },
  card: { backgroundColor: "#111", borderRadius: 12, padding: 12 },
  profileTabsRow: { gap: 8, paddingBottom: 10 },
  profileTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#0d0d0d",
    borderColor: "#1f1f1f",
    borderWidth: 1,
  },
  profileTabActive: { backgroundColor: "#ff6b35", borderColor: "#ff6b35" },
  profileTabText: { color: "#9ca3af", fontWeight: "700", fontSize: 12 },
  profileTabTextActive: { color: "#0d0d0d" },
  walletHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  copiedText: { color: "#10b981", fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  label: { color: "#999", fontSize: 12 },
  value: { color: "#fff", textAlign: "right", flex: 1, marginLeft: 12, fontSize: 12 },
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopColor: "#1f1f1f",
    borderTopWidth: 1,
  },
  walletInfo: { flex: 1, marginRight: 10 },
  walletLabel: { color: "#9ca3af", fontSize: 11 },
  walletValue: { color: "#e5e7eb", fontSize: 12, marginTop: 2 },
  muted: { color: "#999", marginTop: 8, fontSize: 12 },
  error: { color: "#ff6b35" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  logoutBtn: {
    backgroundColor: "#1f1f1f",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  logoutText: { color: "#ff6b35", fontWeight: "700" },
  settingsSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "22%",
    backgroundColor: "#151515",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    gap: 16,
  },
  withdrawSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "25%",
    backgroundColor: "#151515",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    gap: 12,
  },
  withdrawLabel: { color: "#9ca3af", fontSize: 12, fontWeight: "600" },
  withdrawInput: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f9fafb",
    backgroundColor: "#0f0f0f",
    fontSize: 12,
  },
  withdrawActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 6,
  },
  withdrawCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    alignItems: "center",
  },
  withdrawCancelText: { color: "#9ca3af", fontWeight: "700" },
  withdrawSubmit: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#ff6b35",
    alignItems: "center",
  },
  withdrawSubmitText: { color: "#0d0d0d", fontWeight: "700" },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  settingsLabel: { color: "#fafafa", fontWeight: "700" },
  settingsSub: { color: "#9ca3af", fontSize: 12, marginTop: 4 },
  postRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
  },
  postText: { color: "#fafafa", fontSize: 12 },
  postMediaWrap: { width: 48, height: 48, borderRadius: 10, overflow: "hidden" },
  postMedia: { width: "100%", height: "100%" },
  postMediaPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#1f1f1f",
    alignItems: "center",
    justifyContent: "center",
  },
  postMediaBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
  postMediaBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  bannerWrap: { borderRadius: 16, overflow: "hidden" },
  banner: { width: "100%", height: 140 },
  bannerPlaceholder: { width: "100%", height: 140, backgroundColor: "#1f1f1f" },
  profileHeader: {
    marginTop: -32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 2,
  },
  profileActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatarLarge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: "#ff6b35",
    backgroundColor: "#1f1f1f",
  },
  editBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  editBtnText: { color: "#0d0d0d", fontWeight: "700" },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#ff6b35",
    alignItems: "center",
    justifyContent: "center",
  },
  displayName: { fontSize: 20, fontWeight: "700", color: "#fff" },
  username: { color: "#9ca3af", fontSize: 12 },
  bio: { color: "#e5e7eb", marginTop: 6, lineHeight: 18, fontSize: 12 },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
  },
  balanceLabel: { color: "#9ca3af", fontSize: 12 },
  balanceValue: { color: "#fff", fontSize: 12, fontWeight: "600" },
  withdrawButton: {
    marginTop: 8,
    backgroundColor: "#1f1f1f",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  withdrawButtonText: { color: "#ff6b35", fontWeight: "700", fontSize: 12 },
  withdrawHint: { marginTop: 6, fontSize: 11 },
  pointsHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  pointsHeaderCopy: {
    flex: 1,
  },
  pointsValue: { color: "#fff", fontSize: 24, fontWeight: "800" },
  pointsSub: { color: "#9ca3af", fontSize: 12, lineHeight: 18, marginTop: 6 },
  pointsToggle: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1f1f1f",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  pointsToggleText: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
  pointsDetailsWrap: { marginTop: 14 },
  pointsDetailLead: { color: "#cbd5e1", fontSize: 12, lineHeight: 18, marginBottom: 12 },
  pointsRule: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopColor: "#1f1f1f",
    borderTopWidth: 1,
  },
  pointsRuleTitle: { color: "#f3f4f6", fontSize: 12, fontWeight: "700" },
  pointsRuleValue: { color: "#10b981", fontSize: 12, fontWeight: "800" },
  pointsRuleBody: { color: "#9ca3af", fontSize: 11, lineHeight: 16, marginTop: 4, marginBottom: 10 },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
    gap: 10,
  },
  txIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  txIn: {
    backgroundColor: "#22c55e",
  },
  txOut: {
    backgroundColor: "#f97316",
  },
  txTitle: { color: "#fff", fontSize: 12, fontWeight: "700" },
  txMeta: { color: "#9ca3af", fontSize: 10, marginTop: 2 },
  txAmount: { color: "#fff", fontSize: 12, fontWeight: "700" },
  txRight: { alignItems: "flex-end", gap: 4 },
  txLink: { paddingLeft: 6, paddingVertical: 2 },
  txList: { maxHeight: 260 },
  txListContent: { paddingBottom: 2 },
  txLoading: { alignItems: "center", gap: 8, paddingVertical: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalImage: { width: "92%", height: "80%" },
});
