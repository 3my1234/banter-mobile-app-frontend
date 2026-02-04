import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import VoteGauge from "@/components/VoteGauge";
import { normalizeMediaUrl } from "@/lib/media";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

const ROAST_PREFIX = "[ROAST]";
const REACTIONS = [
  { type: "LIKE", icon: "heart-o" },
  { type: "LOVE", icon: "heart" },
  { type: "LAUGH", icon: "smile-o" },
  { type: "FIRE", icon: "fire" },
  { type: "ANGRY", icon: "frown-o" },
  { type: "SAD", icon: "meh-o" },
] as const;

type Post = {
  id: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  isRoast?: boolean;
  tags?: string[];
  league?: string | null;
  stayVotes: number;
  dropVotes: number;
  createdAt: string;
  user?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
};

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  user?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
};

const stripRoastPrefix = (content: string) =>
  content.replace(/^\[ROAST\]\s*/i, "");

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);

  const loadPost = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await apiFetch(`/posts/${id}`);
      setPost(data.post || data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const loadComments = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch(`/comments/${id}?page=1&limit=50`);
      setComments(data.comments || []);
    } catch {
      setComments([]);
    }
  }, [id]);

  useEffect(() => {
    loadPost();
    loadComments();
  }, [loadPost, loadComments]);

  const handleVote = async (voteType: "STAY" | "DROP") => {
    if (!post) return;
    const prev = post;
    setPost({
      ...post,
      stayVotes: post.stayVotes + (voteType === "STAY" ? 1 : 0),
      dropVotes: post.dropVotes + (voteType === "DROP" ? 1 : 0),
    });
    try {
      await apiFetch("/votes", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, voteType }),
      });
    } catch (e: any) {
      setPost(prev);
      setError(e.message);
    }
  };

  const handleReaction = async (type: string) => {
    if (!post) return;
    try {
      await apiFetch("/reactions", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, type }),
      });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSubmitComment = async () => {
    if (!post || !commentText.trim()) return;
    setSubmitting(true);
    try {
      const data = await apiFetch("/comments", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, content: commentText.trim() }),
      });
      const created = data.comment || data;
      setComments((prev) => [...prev, created]);
      setCommentText("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const mediaUrl = normalizeMediaUrl(post?.mediaUrl);
  const avatarUrl = normalizeMediaUrl(post?.user?.avatarUrl);
  const displayName = post?.user?.displayName || post?.user?.username || "Banter";
  const handle = post?.user?.username ? `@${post.user.username}` : "@banter";
  const createdAt = post?.createdAt ? formatRelativeTime(post.createdAt) : "";
  const isRoast = !!post?.isRoast || (post?.content || "").startsWith(ROAST_PREFIX);

  const header = useMemo(() => {
    if (!post) return null;
    return (
      <View style={styles.postCard}>
        <View style={styles.row}>
          {avatarUrl ? (
            <ExpoImage
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              contentFit="cover"
              transition={180}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.avatar} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {displayName} <Text style={styles.handle}>{handle} · {createdAt}</Text>
            </Text>
            <Text style={styles.body}>{stripRoastPrefix(post.content || "")}</Text>
            {mediaUrl ? (
              <Pressable style={styles.mediaWrapper} onPress={() => setShowMedia(true)}>
                {post.mediaType === "video" ? (
                  <Video
                    source={{ uri: mediaUrl }}
                    style={[styles.media, { aspectRatio: 16 / 9 }]}
                    resizeMode={ResizeMode.COVER}
                    useNativeControls
                  />
                ) : (
                  <ExpoImage
                    source={{ uri: mediaUrl }}
                    style={[styles.media, { aspectRatio: 16 / 9 }]}
                    contentFit="cover"
                    contentPosition="center"
                    transition={180}
                    cachePolicy="memory-disk"
                  />
                )}
              </Pressable>
            ) : null}
            {isRoast && (
              <View style={{ marginTop: 10 }}>
                <VoteGauge stayVotes={post.stayVotes} dropVotes={post.dropVotes} />
                <View style={styles.voteActions}>
                  <Pressable style={styles.stayBtn} onPress={() => handleVote("STAY")}>
                    <Text style={styles.voteBtnText}>🔥 Stay</Text>
                  </Pressable>
                  <Pressable style={styles.dropBtn} onPress={() => handleVote("DROP")}>
                    <Text style={styles.voteBtnText}>❄️ Drop</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <View style={styles.reactionsRow}>
              {REACTIONS.map((r) => (
                <Pressable key={r.type} onPress={() => handleReaction(r.type)}>
                  <FontAwesome name={r.icon as any} size={16} color="#9ca3af" />
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }, [post, avatarUrl, displayName, handle, createdAt, isRoast, mediaUrl]);

  const saveMedia = async () => {
    if (!mediaUrl) return;
    setSavingMedia(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        throw new Error("Permission denied");
      }
      const ext = mediaUrl.split(".").pop()?.split("?")[0] || "jpg";
      const fileUri = `${FileSystem.documentDirectory}banter-${Date.now()}.${ext}`;
      const download = await FileSystem.downloadAsync(mediaUrl, fileUri);
      const asset = await MediaLibrary.createAssetAsync(download.uri);
      await MediaLibrary.createAlbumAsync("Banter", asset, false).catch(() => {});
      Alert.alert("Saved", "Media saved to your gallery.");
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Could not save media.");
    } finally {
      setSavingMedia(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading post...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 18 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              {item.user?.avatarUrl ? (
                <ExpoImage
                  source={{ uri: normalizeMediaUrl(item.user.avatarUrl) }}
                  style={styles.commentAvatar}
                  contentFit="cover"
                  transition={180}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.commentAvatar} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.commentName}>
                  {item.user?.displayName || item.user?.username || "User"}
                </Text>
                <Text style={styles.commentText}>{item.content}</Text>
              </View>
            </View>
          )}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadPost();
            loadComments();
          }}
          contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
        />

        <View style={[styles.commentComposer, { paddingBottom: 8 + insets.bottom }]}>
          <TextInput
            style={styles.commentInput}
            placeholder="Write a comment..."
            placeholderTextColor="#777"
            value={commentText}
            onChangeText={setCommentText}
          />
          <Pressable style={styles.commentSend} onPress={handleSubmitComment} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#0d0d0d" />
            ) : (
              <Text style={styles.commentSendText}>Send</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {mediaUrl ? (
        <Modal transparent visible={showMedia} animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setShowMedia(false)}>
            {post?.mediaType === "video" ? (
              <Video
                source={{ uri: mediaUrl }}
                style={styles.modalMedia}
                resizeMode={ResizeMode.CONTAIN}
                useNativeControls
              />
            ) : (
              <ExpoImage
                source={{ uri: mediaUrl }}
                style={styles.modalMedia}
                contentFit="contain"
                contentPosition="center"
                cachePolicy="memory-disk"
              />
            )}
          </Pressable>
          <View style={[styles.modalActions, { paddingBottom: 12 + insets.bottom }]}>
            <Pressable style={styles.modalBtn} onPress={() => setShowMedia(false)}>
              <Text style={styles.modalBtnText}>Close</Text>
            </Pressable>
            <Pressable style={styles.modalBtnPrimary} onPress={saveMedia} disabled={savingMedia}>
              {savingMedia ? (
                <ActivityIndicator color="#0d0d0d" />
              ) : (
                <Text style={styles.modalBtnPrimaryText}>Save</Text>
              )}
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  headerBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  headerTitle: { color: "#fff", fontWeight: "700", fontSize: 16 },
  postCard: { padding: 16, borderBottomColor: "#1d1d1d", borderBottomWidth: 1 },
  row: { flexDirection: "row", gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#1f1f1f" },
  name: { color: "#fafafa", fontWeight: "700" },
  handle: { color: "#888", fontWeight: "400" },
  body: { color: "#fafafa", marginTop: 4, lineHeight: 20 },
  mediaWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#1f1f1f",
  },
  media: { width: "100%" },
  voteActions: { flexDirection: "row", gap: 10, marginTop: 8 },
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
  reactionsRow: { flexDirection: "row", gap: 18, marginTop: 12 },
  commentRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  commentAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#1f1f1f" },
  commentName: { color: "#fafafa", fontWeight: "700" },
  commentText: { color: "#d1d5db", marginTop: 2 },
  commentComposer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#0d0d0d",
    borderTopColor: "#1d1d1d",
    borderTopWidth: 1,
    gap: 10,
  },
  commentInput: {
    flex: 1,
    backgroundColor: "#151515",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: "#fff",
  },
  commentSend: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  commentSendText: { color: "#0d0d0d", fontWeight: "700" },
  muted: { color: "#888", marginTop: 8 },
  error: { color: "#ff6b35", paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalMedia: { width: "96%", height: "80%" },
  modalActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
  },
  modalBtn: {
    flex: 1,
    backgroundColor: "#1f1f1f",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  modalBtnText: { color: "#fff", fontWeight: "700" },
  modalBtnPrimary: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  modalBtnPrimaryText: { color: "#0d0d0d", fontWeight: "700" },
});
