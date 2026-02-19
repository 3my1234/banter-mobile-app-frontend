import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
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

type Session = { token: string; email?: string };

export default function ProfileScreen() {
  const router = useRouter();
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
  const [syncingWallets, setSyncingWallets] = useState(false);
  const [walletsSynced, setWalletsSynced] = useState(false);

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

  const fetchWalletData = async () => {
    try {
      const data = await apiFetch("/wallet/balances");
      setBalances(data?.balances || null);

      const tx = await apiFetch("/wallet/transactions?limit=20&page=1&includeIndexer=1");
      setTransactions(tx?.transactions || []);

      if (!walletsSynced && data?.wallets?.length) {
        setSyncingWallets(true);
        await Promise.all(
          data.wallets.map((wallet: any) =>
            apiFetch(`/wallet/sync/${wallet.id}`, { method: "POST" })
          )
        );
        const refreshed = await apiFetch("/wallet/balances");
        setBalances(refreshed?.balances || null);
        setWalletsSynced(true);
        setSyncingWallets(false);
      }
    } catch (e: any) {
      showToast(e.message || "Failed to sync wallet");
    } finally {
      setSyncingWallets(false);
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

  const logout = async () => {
    await SecureStore.deleteItemAsync("banter_session");
    await SecureStore.deleteItemAsync("banter_pending_registration");
    setSession(null);
    setMe(null);
    router.replace("/(auth)/login");
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

  const handleCopy = async (label: string, value?: string) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopiedWallet(label);
    setTimeout(() => setCopiedWallet(null), 1500);
  };

  const Row = ({ label, value }: { label: string; value?: string }) => (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? "-"}</Text>
    </View>
  );

  const WalletRow = ({ label, value }: { label: string; value?: string }) => (
    <Pressable style={styles.walletRow} onPress={() => handleCopy(label, value)}>
      <View style={styles.walletInfo}>
        <Text style={styles.walletLabel}>{label}</Text>
        <Text style={styles.walletValue} numberOfLines={1}>
          {formatAddress(value)}
        </Text>
      </View>
      <FontAwesome name="copy" size={14} color="#9ca3af" />
    </Pressable>
  );

  if (!sessionLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading your profile...</Text>
      </View>
    );
  }

  if (sessionLoaded && !session?.token) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>You're logged out</Text>
        <Text style={styles.muted}>Redirecting to login…</Text>
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
  const rolBalance = balances?.ROL;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <Text style={styles.muted}>Loading profile…</Text> : null}

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
          <Pressable style={styles.editBtn} onPress={() => router.push("/edit-profile")}>
            <Text style={styles.editBtnText}>Edit profile</Text>
          </Pressable>
        </RNView>

        <Text style={styles.displayName}>{displayName}</Text>
        <Text style={styles.username}>{username}</Text>
        <Text style={styles.bio}>{bio}</Text>

        <View style={styles.card}>
          <View style={styles.walletHeader}>
            <Text style={styles.sectionTitle}>Wallets</Text>
            {copiedWallet ? (
              <Text style={styles.copiedText}>Copied {copiedWallet}</Text>
            ) : null}
          </View>
          <WalletRow label="Solana" value={me?.solanaAddress} />
          <WalletRow label="Movement" value={me?.movementAddress} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Balances</Text>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>SOL</Text>
            <Text style={styles.balanceValue}>
              {solBalance
                ? `${formatTokenAmount(solBalance.balance, solBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>USDC</Text>
            <Text style={styles.balanceValue}>
              {usdcBalance
                ? `${formatTokenAmount(usdcBalance.balance, usdcBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>ROL</Text>
            <Text style={styles.balanceValue}>
              {rolBalance
                ? `${formatTokenAmount(rolBalance.balance, rolBalance.decimals)}`
                : "0.00"}
            </Text>
          </View>
          {syncingWallets ? (
            <Text style={styles.muted}>Syncing wallets…</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Transactions</Text>
          {transactions.length === 0 ? (
            <Text style={styles.muted}>No transactions yet.</Text>
          ) : (
            transactions.map((tx) => {
              const rawType = (tx.txType || tx.type || "").toString().toUpperCase();
              const isDeposit =
                rawType.includes("DEPOSIT") ||
                rawType.includes("CREDIT") ||
                rawType.includes("RECEIVE");
              const icon = isDeposit ? "arrow-down" : "arrow-up";
              const amount = formatTokenAmount(tx.amount, tx.metadata?.decimals || 6);
              const symbol = tx.tokenSymbol || "TOKEN";
              return (
                <View key={tx.id} style={styles.txRow}>
                  <RNView style={[styles.txIconWrap, isDeposit ? styles.txIn : styles.txOut]}>
                    <FontAwesome name={icon} size={12} color="#0d0d0d" />
                  </RNView>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle}>
                      {isDeposit ? "Deposit" : "Payment"}
                    </Text>
                    <Text style={styles.txMeta} numberOfLines={1}>
                      {tx.txHash ? tx.txHash.slice(0, 12) + "…" : "On-chain"}
                    </Text>
                  </View>
                  <Text style={styles.txAmount}>
                    {isDeposit ? "+" : "-"} {amount} {symbol}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your posts</Text>
          {userPosts.length === 0 ? (
            <Text style={styles.muted}>Posts will appear here.</Text>
          ) : (
            userPosts.map((post) => (
              <View key={post.id} style={styles.postRow}>
                <Text style={styles.postText} numberOfLines={2}>
                  {post.content}
                </Text>
              </View>
            ))
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
  postRow: { paddingVertical: 8, borderBottomColor: "#1f1f1f", borderBottomWidth: 1 },
  postText: { color: "#fafafa", fontSize: 12 },
  bannerWrap: { borderRadius: 16, overflow: "hidden" },
  banner: { width: "100%", height: 140 },
  bannerPlaceholder: { width: "100%", height: 140, backgroundColor: "#1f1f1f" },
  profileHeader: {
    marginTop: -32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatarLarge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: "#0d0d0d",
    backgroundColor: "#1f1f1f",
  },
  editBtn: {
    backgroundColor: "#1f1f1f",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  editBtnText: { color: "#ff6b35", fontWeight: "700" },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalImage: { width: "92%", height: "80%" },
});
