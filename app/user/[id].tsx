import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View as RNView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, View } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { normalizeMediaUrl } from "@/lib/media";
import { Image as ExpoImage } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  getFollowStatus,
  setFollowStatus,
  subscribeFollowStatus,
} from "@/lib/followStore";

export default function UserProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [profileTab, setProfileTab] = useState<"posts" | "banter">("posts");
  const [profileLocked, setProfileLocked] = useState(false);

  const detectMediaType = (uri?: string | null, fallback?: string | null) => {
    if (fallback) return fallback;
    if (!uri) return undefined;
    const lower = uri.toLowerCase();
    if (lower.match(/\.(mp4|mov|m4v|webm|m3u8)$/)) return "video";
    return "image";
  };

  const loadProfile = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await apiFetch(`/users/${id}`);
      setProfile(data.user);
      setFollowing(!!data.isFollowing);
      setFollowStatus(String(id), !!data.isFollowing);
      const locked = !!data.user?.profileLocked && !data.isFollowing;
      setProfileLocked(locked);
      if (!locked) {
        const posts = await apiFetch(`/users/${id}/posts`);
        setUserPosts(posts.posts || []);
      } else {
        setUserPosts([]);
      }
    } catch {
      setProfile(null);
      setUserPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const cached = getFollowStatus(String(id));
    if (typeof cached === "boolean") {
      setFollowing(cached);
    }
    const unsubscribe = subscribeFollowStatus((userId, isFollowing) => {
      if (String(userId) === String(id)) {
        setFollowing(isFollowing);
      }
    });
    return unsubscribe;
  }, [id]);

  const toggleFollow = async () => {
    if (!id || followLoading) return;
    try {
      setFollowLoading(true);
      if (following) {
        await apiFetch(`/users/${id}/follow`, { method: "DELETE" });
        setFollowing(false);
        setFollowStatus(String(id), false);
        setProfile((prev: any) =>
          prev ? { ...prev, followersCount: Math.max(0, prev.followersCount - 1) } : prev
        );
      } else {
        await apiFetch(`/users/${id}/follow`, { method: "POST" });
        setFollowing(true);
        setFollowStatus(String(id), true);
        setProfile((prev: any) =>
          prev ? { ...prev, followersCount: (prev.followersCount || 0) + 1 } : prev
        );
      }
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <RNView style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading profile...</Text>
        </RNView>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <RNView style={styles.center}>
          <Text style={styles.muted}>User not found.</Text>
        </RNView>
      </SafeAreaView>
    );
  }

  if (profileLocked && !following) {
    return (
      <SafeAreaView style={styles.safe}>
        <RNView style={styles.center}>
          <Text style={styles.muted}>This profile is locked.</Text>
          <Text style={styles.muted}>Follow the user to view their posts.</Text>
          <Pressable
            onPress={toggleFollow}
            style={[styles.followBtn, followLoading && styles.followingBtn]}
            disabled={followLoading}
          >
            <Text style={styles.followBtnText}>
              {followLoading ? "Loading..." : "Follow"}
            </Text>
          </Pressable>
        </RNView>
      </SafeAreaView>
    );
  }

  const avatarUrl = normalizeMediaUrl(profile.avatarUrl);
  const bannerUrl = normalizeMediaUrl(profile.bannerUrl);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <RNView style={styles.bannerWrap}>
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
          </RNView>

          <RNView style={styles.profileHeader}>
            <ExpoImage
              source={avatarUrl ? { uri: avatarUrl } : undefined}
              style={styles.avatarLarge}
              contentFit="cover"
              transition={120}
              cachePolicy="memory-disk"
            />
            <Pressable
              style={[styles.followBtn, following && styles.followingBtn]}
              onPress={toggleFollow}
              disabled={followLoading}
            >
              <Text style={styles.followBtnText}>
                {following ? "Following" : "Follow"}
              </Text>
            </Pressable>
          </RNView>

          <Text style={styles.displayName}>{profile.displayName || "User"}</Text>
          <Text style={styles.username}>@{profile.username || "user"}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <RNView style={styles.followStats}>
            <Text style={styles.statText}>
              {profile.followersCount || 0} followers
            </Text>
            <Text style={styles.statText}>
              {profile.followingCount || 0} following
            </Text>
          </RNView>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Activity</Text>
          <RNView style={styles.profileTabsRow}>
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
          </RNView>

          {(() => {
            const filtered =
              profileTab === "posts"
                ? userPosts.filter((p) => !p.isRoast)
                : userPosts.filter((p) => p.isRoast);
            if (filtered.length === 0) {
              return (
                <Text style={styles.muted}>
                  {profileTab === "posts" ? "No posts yet." : "No banter yet."}
                </Text>
              );
            }
            return filtered.map((post) => {
              const mediaUrl = normalizeMediaUrl(post.mediaUrl);
              const mediaType = detectMediaType(mediaUrl, post.mediaType);
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
                      {mediaType === "video" ? (
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
                    <Text style={styles.postText} numberOfLines={2}>
                      {post.content || "No text"}
                    </Text>
                  </View>
                </Pressable>
              );
            });
          })()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: "#111", borderRadius: 12, padding: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#fff", marginBottom: 8 },
  muted: { color: "#999", marginTop: 8, fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
    borderWidth: 2,
    borderColor: "#ff6b35",
    backgroundColor: "#1f1f1f",
  },
  followBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  followingBtn: { backgroundColor: "#1f1f1f" },
  followBtnText: { color: "#fff", fontWeight: "700" },
  displayName: { fontSize: 20, fontWeight: "700", color: "#fff" },
  username: { color: "#9ca3af", fontSize: 12 },
  bio: { color: "#e5e7eb", marginTop: 6, lineHeight: 18, fontSize: 12 },
  followStats: { flexDirection: "row", gap: 16, marginTop: 8 },
  statText: { color: "#9ca3af", fontSize: 12 },
  profileTabsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  profileTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1a1a1a",
  },
  profileTabActive: {
    backgroundColor: "rgba(255,107,53,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.5)",
  },
  profileTabText: { color: "#9ca3af", fontWeight: "700", fontSize: 12 },
  profileTabTextActive: { color: "#ff6b35" },
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
});
