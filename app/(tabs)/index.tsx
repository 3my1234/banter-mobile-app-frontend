import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/Themed";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { useRouter } from "expo-router";
import VoteGauge from "@/components/VoteGauge";
import { apiFetch } from "@/lib/api";
import { normalizeMediaUrl } from "@/lib/media";
import { formatRelativeTime } from "@/lib/time";
import { useFocusEffect } from "@react-navigation/native";
import { getSocket } from "@/lib/socket";

type Post = {
  id: string;
  name: string;
  handle: string;
  time: string;
  text: string;
  media?: { type: "image" | "video"; uri: string; ratio?: number };
  type: "banter" | "roast";
  stayVotes: number;
  dropVotes: number;
  avatarUrl?: string | null;
  tags?: string[];
  league?: string | null;
  commentCount?: number;
  reactionCount?: number;
};

const ROAST_PREFIX = "[ROAST]";

const detectMediaType = (uri?: string | null) => {
  if (!uri) return undefined;
  const lower = uri.toLowerCase();
  if (lower.match(/\.(mp4|mov|m4v|webm)$/)) return "video";
  return "image";
};

const stripRoastPrefix = (content: string) =>
  content.replace(/^\[ROAST\]\s*/i, "");

export default function HomeFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"forYou" | "following" | "hot">("forYou");
  const [meAvatar, setMeAvatar] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch(`/posts?feed=${tab}&page=1&limit=20`);
      const mapped = (data.posts || []).map((post: any) => {
        const isRoast =
          typeof post.content === "string" &&
          (post.isRoast ||
            post.content.toUpperCase().startsWith(ROAST_PREFIX));
        const mediaUrl = normalizeMediaUrl(post.mediaUrl);
        const mediaType = post.mediaType || detectMediaType(mediaUrl);
        const avatarUrl = normalizeMediaUrl(post.user?.avatarUrl);
        return {
          id: post.id,
          name: post.user?.displayName || post.user?.username || "Banter",
          handle: post.user?.username ? `@${post.user.username}` : "@banter",
          time: formatRelativeTime(post.createdAt),
          text: stripRoastPrefix(post.content || ""),
          type: isRoast ? "roast" : "banter",
          media: mediaUrl
            ? {
                type: mediaType as "image" | "video",
                uri: mediaUrl,
                ratio: 16 / 9,
              }
            : undefined,
          stayVotes: post.stayVotes ?? 0,
          dropVotes: post.dropVotes ?? 0,
          avatarUrl: avatarUrl ?? null,
          tags: post.tags || [],
          league: post.league || null,
          commentCount: post.commentCount ?? 0,
          reactionCount: post.reactionCount ?? 0,
        } as Post;
      });
      setPosts(mapped);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  const loadMe = useCallback(async () => {
    try {
      const data = await apiFetch("/auth/me", undefined, true);
      const user = data.user || data;
      setMeAvatar(normalizeMediaUrl(user?.avatarUrl) ?? null);
    } catch {
      setMeAvatar(null);
    }
  }, []);

  React.useEffect(() => {
    loadPosts();
    loadMe();
  }, [loadPosts]);

  useFocusEffect(
    useCallback(() => {
      loadPosts();
      loadMe();
    }, [loadPosts, loadMe])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadPosts();
  };

  const handleVote = async (postId: string, voteType: "STAY" | "DROP") => {
    try {
      const data = await apiFetch("/votes", {
        method: "POST",
        body: JSON.stringify({ postId, voteType }),
      });
      const next = data?.post;
      if (next?.id) {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === next.id
              ? { ...p, stayVotes: next.stayVotes, dropVotes: next.dropVotes }
              : p
          )
        );
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  React.useEffect(() => {
    let active = true;
    let socket: any;

    const setup = async () => {
      socket = await getSocket();
      if (!active) return;

      const onVoteUpdate = (payload: any) => {
        const { postId, stayVotes, dropVotes } = payload || {};
        if (!postId) return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, stayVotes, dropVotes } : p
          )
        );
      };

      const onPostHidden = (payload: any) => {
        const { postId } = payload || {};
        if (!postId) return;
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      };

      const onCommentCreated = (payload: any) => {
        const { postId, commentCount } = payload || {};
        if (!postId) return;
        if (typeof commentCount !== "number") return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, commentCount } : p
          )
        );
      };

      const onReactionUpdate = (payload: any) => {
        const { postId, reactionCount } = payload || {};
        if (!postId) return;
        if (typeof reactionCount !== "number") return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, reactionCount } : p
          )
        );
      };

      socket.on("vote-update", onVoteUpdate);
      socket.on("post-hidden", onPostHidden);
      socket.on("comment-created", onCommentCreated);
      socket.on("reaction-update", onReactionUpdate);

      socket.on("post-stays", () => {});
    };

    setup();

    return () => {
      active = false;
      if (socket) {
        socket.off("vote-update");
        socket.off("post-hidden");
        socket.off("comment-created");
        socket.off("reaction-update");
        socket.off("post-stays");
      }
    };
  }, []);

  const visiblePosts = useMemo(() => posts, [posts]);

  const renderItem = ({ item }: { item: Post }) => {
    const isRoast = item.type === "roast";
    return (
      <Pressable style={styles.card} onPress={() => router.push(`/post/${item.id}`)}>
        <View style={styles.row}>
          <View style={styles.avatarWrap}>
            {item.avatarUrl ? (
              <ExpoImage
                source={{ uri: item.avatarUrl }}
                style={styles.avatar}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.avatar} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {item.name}{" "}
              <Text style={styles.handle}>
                {item.handle} · {item.time}
              </Text>
            </Text>
            <Text style={styles.body}>{item.text}</Text>
            {(item as any).tags?.length ? (
              <View style={styles.tagsRow}>
                {(item as any).tags.map((tag: string) => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagText}>
                      {tag.startsWith("#") ? tag : `#${tag}`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {item.media ? (
              <View style={styles.mediaWrapper}>
                {item.media.type === "video" ? (
                  <Video
                    source={{ uri: item.media.uri }}
                    style={[
                      styles.media,
                      item.media.ratio
                        ? { aspectRatio: item.media.ratio }
                        : { aspectRatio: 16 / 9 },
                    ]}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={false}
                    useNativeControls
                  />
                ) : (
                  <ExpoImage
                    source={{ uri: item.media.uri }}
                    style={[
                      styles.media,
                      item.media.ratio
                        ? { aspectRatio: item.media.ratio }
                        : { aspectRatio: 16 / 9 },
                    ]}
                    contentFit="cover"
                    contentPosition="center"
                    transition={180}
                    cachePolicy="memory-disk"
                  />
                )}
              </View>
            ) : null}
            {isRoast && (
              <View style={{ marginTop: 10 }}>
                <VoteGauge stayVotes={item.stayVotes} dropVotes={item.dropVotes} />
                <View style={styles.voteActions}>
                  <Pressable
                    style={styles.stayBtn}
                    onPress={() => handleVote(item.id, "STAY")}
                  >
                    <Text style={styles.voteBtnText}>🔥 Stay</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dropBtn}
                    onPress={() => handleVote(item.id, "DROP")}
                  >
                    <Text style={styles.voteBtnText}>❄️ Drop</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <View style={styles.actions}>
              <FontAwesome name="comment-o" size={14} color="#777" />
              <FontAwesome name="retweet" size={14} color="#777" />
              <FontAwesome name="heart-o" size={14} color="#777" />
              <FontAwesome name="smile-o" size={14} color="#777" />
              <FontAwesome name="share-alt" size={14} color="#777" />
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.push("/(tabs)/profile")}>
            {meAvatar ? (
              <ExpoImage
                source={{ uri: meAvatar }}
                style={styles.avatarSmall}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.avatarSmall} />
            )}
          </Pressable>
          <Text style={styles.brand}>Banter</Text>
          <FontAwesome name="cog" size={18} color="#fff" />
        </View>

        <View style={styles.tabs}>
          <Pressable onPress={() => setTab("forYou")}>
            <Text style={[styles.tab, tab === "forYou" && styles.tabActive]}>
              For you
            </Text>
          </Pressable>
          <Pressable onPress={() => setTab("following")}>
            <Text style={[styles.tab, tab === "following" && styles.tabActive]}>
              Following
            </Text>
          </Pressable>
          <Pressable onPress={() => setTab("hot")}>
            <Text style={[styles.tab, tab === "hot" && styles.tabActive]}>
              Hot
            </Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading banter...</Text>
          </View>
        ) : null}

        <FlatList
          data={visiblePosts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />

        <Pressable
          style={styles.fab}
          onPress={() => router.push("/(tabs)/compose")}
        >
          <FontAwesome name="plus" size={20} color="#0d0d0d" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  topBar: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  brand: { color: "#fff", fontWeight: "700", fontSize: 18 },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1f1f1f",
  },
  tabs: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  tab: { color: "#999", fontWeight: "600" },
  tabActive: { color: "#ff6b35" },
  card: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 16 },
  row: { flexDirection: "row", gap: 12, flex: 1 },
  avatarWrap: { width: 42, height: 42 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#1f1f1f",
  },
  name: { color: "#fafafa", fontWeight: "700" },
  handle: { color: "#888", fontWeight: "400" },
  body: { color: "#fafafa", marginTop: 4, lineHeight: 20 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tagChip: {
    backgroundColor: "#151515",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 18, marginTop: 10 },
  separator: { height: 1, backgroundColor: "#1d1d1d" },
  mediaWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#1f1f1f",
  },
  media: { width: "100%", alignSelf: "center" },
  voteActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  stayBtn: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  dropBtn: {
    flex: 1,
    backgroundColor: "#1e3a8a",
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: "center",
  },
  voteBtnText: { color: "#fafafa", fontWeight: "700" },
  muted: { color: "#888", marginTop: 8 },
  error: { color: "#ff6b35", paddingHorizontal: 16, paddingTop: 8 },
  center: { padding: 16, alignItems: "center" },
  fab: {
    position: "absolute",
    right: 18,
    bottom: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ff6b35",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
