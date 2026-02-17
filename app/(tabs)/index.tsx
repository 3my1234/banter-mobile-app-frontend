import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

type RepostOf = {
  id: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  isRoast?: boolean;
  tags?: string[];
  league?: string | null;
  createdAt?: string;
  user?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
};

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
  shareCount?: number;
  reactionBreakdown?: Record<string, number>;
  repostCount?: number;
  repostOf?: RepostOf | null;
  raw?: any;
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
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [banters, setBanters] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"posts" | "banter">("posts");
  const [postTab, setPostTab] = useState<"forYou" | "following">("forYou");
  const [banterTab, setBanterTab] = useState<"hot" | "following">("hot");
  const [meAvatar, setMeAvatar] = useState<string | null>(null);
  const [activeBanterId, setActiveBanterId] = useState<string | null>(null);
  const [repostTarget, setRepostTarget] = useState<Post | null>(null);
  const [quoteText, setQuoteText] = useState<string>("");
  const [showRepostModal, setShowRepostModal] = useState(false);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 });

  const mapPost = (post: any): Post => {
    const isRoast =
      typeof post.content === "string" &&
      (post.isRoast || post.content.toUpperCase().startsWith(ROAST_PREFIX));
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
      shareCount: post.shareCount ?? 0,
      reactionBreakdown: post.reactionBreakdown || {},
      repostCount: post.repostCount ?? 0,
      repostOf: post.repostOf || null,
      raw: post,
    } as Post;
  };

  const loadPosts = useCallback(async (type: "posts" | "banter", feed: string) => {
    try {
      setError(null);
      const data = await apiFetch(`/posts?type=${type}&feed=${feed}&page=1&limit=20`);
      const mapped = (data.posts || []).map(mapPost);
      if (type === "posts") {
        setPosts(mapped);
      } else {
        setBanters(mapped);
        setActiveBanterId(mapped[0]?.id || null);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
    if (mainTab === "posts") {
      loadPosts("posts", postTab);
    } else {
      loadPosts("banter", banterTab);
    }
    loadMe();
  }, [loadPosts, loadMe, mainTab, postTab, banterTab]);

  useFocusEffect(
    useCallback(() => {
      if (mainTab === "posts") {
        loadPosts("posts", postTab);
      } else {
        loadPosts("banter", banterTab);
      }
      loadMe();
    }, [loadPosts, loadMe, mainTab, postTab, banterTab])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    if (mainTab === "posts") {
      loadPosts("posts", postTab);
    } else {
      loadPosts("banter", banterTab);
    }
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
        setBanters((prev) =>
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

  const handleReaction = async (postId: string, type: "LOVE" | "ANGRY") => {
    try {
      const data = await apiFetch("/reactions", {
        method: "POST",
        body: JSON.stringify({ postId, type }),
      });
      const reactionCount = data?.reactionCount;
      const reactionBreakdown = data?.reactionBreakdown;
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                reactionCount:
                  typeof reactionCount === "number" ? reactionCount : p.reactionCount,
                reactionBreakdown: reactionBreakdown || p.reactionBreakdown,
              }
            : p
        )
      );
      setBanters((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                reactionCount:
                  typeof reactionCount === "number" ? reactionCount : p.reactionCount,
                reactionBreakdown: reactionBreakdown || p.reactionBreakdown,
              }
            : p
        )
      );
    } catch (e: any) {
      setError(e.message);
    }
  };

  const downloadMedia = async (uri: string) => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        throw new Error("Permission denied");
      }
      const ext = uri.split(".").pop()?.split("?")[0] || "jpg";
      const fileUri = `${FileSystem.documentDirectory}banter-${Date.now()}.${ext}`;
      const download = await FileSystem.downloadAsync(uri, fileUri);
      const asset = await MediaLibrary.createAssetAsync(download.uri);
      await MediaLibrary.createAlbumAsync("Banter", asset, false).catch(() => {});
      Alert.alert("Saved", "Media saved to your gallery.");
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Could not save media.");
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
        setBanters((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, stayVotes, dropVotes } : p
          )
        );
      };

      const onPostHidden = (payload: any) => {
        const { postId } = payload || {};
        if (!postId) return;
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        setBanters((prev) => prev.filter((p) => p.id !== postId));
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
        setBanters((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, commentCount } : p
          )
        );
      };

      const onReactionUpdate = (payload: any) => {
        const { postId, reactionCount, reactionBreakdown } = payload || {};
        if (!postId) return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  reactionCount:
                    typeof reactionCount === "number"
                      ? reactionCount
                      : p.reactionCount,
                  reactionBreakdown: reactionBreakdown || p.reactionBreakdown,
                }
              : p
          )
        );
        setBanters((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  reactionCount:
                    typeof reactionCount === "number"
                      ? reactionCount
                      : p.reactionCount,
                  reactionBreakdown: reactionBreakdown || p.reactionBreakdown,
                }
              : p
          )
        );
      };

      const onShareUpdate = (payload: any) => {
        const { postId, shareCount } = payload || {};
        if (!postId) return;
        if (typeof shareCount !== "number") return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, shareCount } : p
          )
        );
        setBanters((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, shareCount } : p
          )
        );
      };

      const onRepostUpdate = (payload: any) => {
        const { postId, repostCount } = payload || {};
        if (!postId) return;
        if (typeof repostCount !== "number") return;
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, repostCount } : p
          )
        );
        setBanters((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, repostCount } : p
          )
        );
      };

      socket.on("vote-update", onVoteUpdate);
      socket.on("post-hidden", onPostHidden);
      socket.on("comment-created", onCommentCreated);
      socket.on("reaction-update", onReactionUpdate);
      socket.on("share-update", onShareUpdate);
      socket.on("repost-update", onRepostUpdate);

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
        socket.off("share-update");
        socket.off("repost-update");
        socket.off("post-stays");
      }
    };
  }, []);

  const visiblePosts = useMemo(() => posts, [posts]);

  const handleShare = async (item: Post) => {
    try {
      const message =
        item.text?.trim() ||
        item.repostOf?.content?.trim() ||
        "Banter post";
      await Share.share({ message });
      const data = await apiFetch(`/posts/${item.id}/share`, { method: "POST" });
      if (typeof data?.shareCount === "number") {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, shareCount: data.shareCount } : p
          )
        );
        setBanters((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, shareCount: data.shareCount } : p
          )
        );
      }
    } catch {
      // ignore
    }
  };

  const handleRepost = async (item: Post, comment?: string) => {
    try {
      const data = await apiFetch(`/posts/${item.id}/repost`, {
        method: "POST",
        body: JSON.stringify({ comment: comment || "" }),
      });
      if (typeof data?.repostCount === "number") {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, repostCount: data.repostCount } : p
          )
        );
        setBanters((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, repostCount: data.repostCount } : p
          )
        );
      }
      if (mainTab === "posts") {
        loadPosts("posts", postTab);
      } else {
        loadPosts("banter", banterTab);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const openRepostModal = (item: Post) => {
    setRepostTarget(item);
    setQuoteText("");
    setShowRepostModal(true);
  };

  const renderMedia = (
    media: { type: "image" | "video"; uri: string; ratio?: number },
    allowDownload: boolean
  ) => {
    if (media.type === "video") {
      return (
        <View style={styles.mediaWrapper}>
          <Video
            source={{ uri: media.uri }}
            style={[
              styles.media,
              media.ratio ? { aspectRatio: media.ratio } : { aspectRatio: 16 / 9 },
            ]}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            useNativeControls
          />
          {allowDownload ? (
            <Pressable
              style={styles.mediaDownload}
              onPress={() => downloadMedia(media.uri)}
            >
              <FontAwesome name="download" size={14} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      );
    }

    return (
      <View style={styles.mediaWrapper}>
        <ExpoImage
          source={{ uri: media.uri }}
          style={[
            styles.media,
            media.ratio ? { aspectRatio: media.ratio } : { aspectRatio: 16 / 9 },
          ]}
          contentFit="cover"
          contentPosition="center"
          transition={180}
          cachePolicy="memory-disk"
        />
      </View>
    );
  };

  const renderPostItem = ({ item }: { item: Post }) => {
    const isRoast = item.type === "roast";
    const loveCount = item.reactionBreakdown?.LOVE ?? 0;
    const dislikeCount = item.reactionBreakdown?.ANGRY ?? 0;
    const isRepost = !!item.repostOf;
    const original = item.repostOf;
    const originalMediaUrl = normalizeMediaUrl(original?.mediaUrl);
    const originalMediaType = original?.mediaType || detectMediaType(originalMediaUrl);
    const originalMedia = originalMediaUrl
      ? {
          type: originalMediaType as "image" | "video",
          uri: originalMediaUrl,
          ratio: 16 / 9,
        }
      : null;

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
            {isRepost ? (
              <Text style={styles.repostLabel}>
                {original?.isRoast ? "Rebantered" : "Reposted"} by {item.handle}
              </Text>
            ) : null}
            <Text style={styles.name}>
              {item.name}{" "}
              <Text style={styles.handle}>
                {item.handle} - {item.time}
              </Text>
            </Text>
            {item.text?.trim() ? <Text style={styles.body}>{item.text}</Text> : null}
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
            {item.media ? renderMedia(item.media, true) : null}
            {isRepost ? (
              <View style={styles.repostCard}>
                <Text style={styles.repostAuthor}>
                  {original?.user?.displayName ||
                    original?.user?.username ||
                    "Banter"}{" "}
                  <Text style={styles.handle}>
                    {original?.user?.username
                      ? `@${original.user.username}`
                      : "@banter"}
                  </Text>
                </Text>
                <Text style={styles.repostBody}>
                  {stripRoastPrefix(original?.content || "")}
                </Text>
                {originalMedia ? renderMedia(originalMedia, true) : null}
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
                    <Text style={styles.voteBtnText}>Stay</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dropBtn}
                    onPress={() => handleVote(item.id, "DROP")}
                  >
                    <Text style={styles.voteBtnText}>Drop</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <View style={styles.actions}>
              <Pressable
                style={styles.actionItem}
                onPress={() => router.push(`/post/${item.id}`)}
              >
                <FontAwesome name="comment-o" size={14} color="#9ca3af" />
                <Text style={styles.actionText}>{item.commentCount ?? 0}</Text>
              </Pressable>
              <Pressable
                style={styles.actionItem}
                onPress={() => openRepostModal(item)}
              >
                <FontAwesome name="retweet" size={14} color="#9ca3af" />
                <Text style={styles.actionText}>{item.repostCount ?? 0}</Text>
              </Pressable>
              <Pressable
                style={styles.actionItem}
                onPress={() => handleReaction(item.id, "LOVE")}
              >
                <FontAwesome name="heart" size={14} color="#9ca3af" />
                <Text style={styles.actionText}>{loveCount}</Text>
              </Pressable>
              <Pressable
                style={styles.actionItem}
                onPress={() => handleReaction(item.id, "ANGRY")}
              >
                <FontAwesome name="thumbs-down" size={14} color="#9ca3af" />
                <Text style={styles.actionText}>{dislikeCount}</Text>
              </Pressable>
              <Pressable style={styles.actionItem} onPress={() => handleShare(item)}>
                <FontAwesome name="share-alt" size={14} color="#9ca3af" />
                <Text style={styles.actionText}>{item.shareCount ?? 0}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderBanterItem = ({ item }: { item: Post }) => {
    const loveCount = item.reactionBreakdown?.LOVE ?? 0;
    const dislikeCount = item.reactionBreakdown?.ANGRY ?? 0;
    const media = item.media;
    const isVideo = media?.type === "video";
    const isRepost = !!item.repostOf;
    const banterHeight = Math.max(360, windowHeight - insets.top - 110);

    return (
      <View style={[styles.banterCard, { height: banterHeight }]}>
        <Pressable
          style={styles.banterMedia}
          onPress={() => router.push(`/post/${item.id}`)}
        >
          {media ? (
            isVideo ? (
              <Video
                source={{ uri: media.uri }}
                style={styles.banterMediaFill}
                resizeMode={ResizeMode.COVER}
                shouldPlay={activeBanterId === item.id}
                isLooping
              />
            ) : (
              <ExpoImage
                source={{ uri: media.uri }}
                style={styles.banterMediaFill}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
              />
            )
          ) : (
            <View style={styles.banterPlaceholder} />
          )}
        </Pressable>
        <View style={styles.banterOverlay}>
          <View style={styles.banterMeta}>
            {isRepost ? (
              <Text style={styles.banterRepostLabel}>
                {item.repostOf?.isRoast ? "Rebantered" : "Reposted"} by {item.handle}
              </Text>
            ) : null}
            <Text style={styles.banterUser}>{item.name}</Text>
            <Text style={styles.banterHandle}>{item.handle}</Text>
            {item.text?.trim() ? (
              <Text style={styles.banterText}>{item.text}</Text>
            ) : null}
            {item.tags?.length ? (
              <View style={styles.banterTags}>
                {item.tags.map((tag) => (
                  <Text key={tag} style={styles.banterTagText}>
                    {tag.startsWith("#") ? tag : `#${tag}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.banterSideActions}>
            <Pressable
              style={styles.banterAction}
              onPress={() => router.push(`/post/${item.id}`)}
            >
              <FontAwesome name="comment-o" size={20} color="#fff" />
              <Text style={styles.banterActionText}>{item.commentCount ?? 0}</Text>
            </Pressable>
            <Pressable style={styles.banterAction} onPress={() => openRepostModal(item)}>
              <FontAwesome name="retweet" size={20} color="#fff" />
              <Text style={styles.banterActionText}>{item.repostCount ?? 0}</Text>
            </Pressable>
            <Pressable
              style={styles.banterAction}
              onPress={() => handleReaction(item.id, "LOVE")}
            >
              <FontAwesome name="heart" size={20} color="#fff" />
              <Text style={styles.banterActionText}>{loveCount}</Text>
            </Pressable>
            <Pressable
              style={styles.banterAction}
              onPress={() => handleReaction(item.id, "ANGRY")}
            >
              <FontAwesome name="thumbs-down" size={20} color="#fff" />
              <Text style={styles.banterActionText}>{dislikeCount}</Text>
            </Pressable>
            <Pressable style={styles.banterAction} onPress={() => handleShare(item)}>
              <FontAwesome name="share-alt" size={20} color="#fff" />
              <Text style={styles.banterActionText}>{item.shareCount ?? 0}</Text>
            </Pressable>
          </View>
          <View style={styles.banterStayDropRow}>
            <Pressable
              style={styles.banterStayBtn}
              onPress={() => handleVote(item.id, "STAY")}
            >
              <Text style={styles.banterStayText}>Stay</Text>
            </Pressable>
            <Pressable
              style={styles.banterDropBtn}
              onPress={() => handleVote(item.id, "DROP")}
            >
              <Text style={styles.banterStayText}>Drop</Text>
            </Pressable>
          </View>
        </View>
      </View>
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

        <View style={styles.mainTabs}>
          <Pressable onPress={() => setMainTab("posts")}>
            <Text
              style={[
                styles.mainTab,
                mainTab === "posts" && styles.mainTabActive,
              ]}
            >
              Posts
            </Text>
          </Pressable>
          <Pressable onPress={() => setMainTab("banter")}>
            <Text
              style={[
                styles.mainTab,
                mainTab === "banter" && styles.mainTabActive,
              ]}
            >
              Banter
            </Text>
          </Pressable>
        </View>

        <View style={styles.subTabs}>
          {mainTab === "posts" ? (
            <>
              <Pressable onPress={() => setPostTab("forYou")}>
                <Text
                  style={[
                    styles.tab,
                    postTab === "forYou" && styles.tabActive,
                  ]}
                >
                  For you
                </Text>
              </Pressable>
              <Pressable onPress={() => setPostTab("following")}>
                <Text
                  style={[
                    styles.tab,
                    postTab === "following" && styles.tabActive,
                  ]}
                >
                  Following
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setBanterTab("hot")}>
                <Text
                  style={[styles.tab, banterTab === "hot" && styles.tabActive]}
                >
                  Trending
                </Text>
              </Pressable>
              <Pressable onPress={() => setBanterTab("following")}>
                <Text
                  style={[
                    styles.tab,
                    banterTab === "following" && styles.tabActive,
                  ]}
                >
                  Following
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.muted}>
              {mainTab === "posts" ? "Loading posts..." : "Loading banter..."}
            </Text>
          </View>
        ) : null}

        {mainTab === "posts" ? (
          <FlatList
            data={visiblePosts}
            keyExtractor={(item) => item.id}
            renderItem={renderPostItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: 100 }}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        ) : (
          <FlatList
            data={banters}
            keyExtractor={(item) => item.id}
            renderItem={renderBanterItem}
            pagingEnabled
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            viewabilityConfig={viewabilityConfig.current}
            onViewableItemsChanged={({ viewableItems }) => {
              const next = viewableItems.find((v) => v.isViewable);
              if (next?.item?.id) setActiveBanterId(next.item.id);
            }}
          />
        )}

        <Pressable
          style={styles.fab}
          onPress={() => router.push("/(tabs)/compose")}
        >
          <FontAwesome name="plus" size={20} color="#0d0d0d" />
        </Pressable>

        {showRepostModal && repostTarget ? (
          <Modal transparent animationType="fade" visible>
            <Pressable
              style={styles.repostBackdrop}
              onPress={() => setShowRepostModal(false)}
            />
            <View style={styles.repostSheet}>
              <Text style={styles.repostTitle}>
                {repostTarget.type === "roast" || repostTarget.repostOf?.isRoast
                  ? "Rebanter"
                  : "Repost"}
              </Text>
              <TextInput
                style={styles.repostInput}
                placeholder="Add a comment (optional)"
                placeholderTextColor="#777"
                value={quoteText}
                onChangeText={setQuoteText}
                multiline
              />
              <View style={styles.repostActions}>
                <Pressable
                  style={styles.repostBtn}
                  onPress={() => {
                    setShowRepostModal(false);
                    handleRepost(repostTarget);
                  }}
                >
                  <Text style={styles.repostBtnText}>
                    {repostTarget.type === "roast" || repostTarget.repostOf?.isRoast
                      ? "Rebanter"
                      : "Repost"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.repostBtnPrimary}
                  onPress={() => {
                    setShowRepostModal(false);
                    handleRepost(repostTarget, quoteText.trim());
                  }}
                >
                  <Text style={styles.repostBtnPrimaryText}>Quote</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        ) : null}
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
  mainTabs: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  mainTab: { color: "#777", fontWeight: "700", fontSize: 16 },
  mainTabActive: { color: "#ff6b35" },
  subTabs: {
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
  actions: { flexDirection: "row", gap: 18, marginTop: 10, alignItems: "center" },
  actionItem: { flexDirection: "row", gap: 6, alignItems: "center" },
  actionText: { color: "#9ca3af", fontSize: 12 },
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
  mediaDownload: {
    position: "absolute",
    right: 8,
    top: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 6,
    borderRadius: 999,
  },
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
  repostLabel: {
    color: "#ff6b35",
    fontWeight: "700",
    marginBottom: 4,
  },
  repostCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#151515",
    borderColor: "#1f1f1f",
    borderWidth: 1,
  },
  repostAuthor: { color: "#fafafa", fontWeight: "700" },
  repostBody: { color: "#d1d5db", marginTop: 4 },
  banterCard: {
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    overflow: "hidden",
    backgroundColor: "#111",
  },
  banterMedia: { flex: 1 },
  banterMediaFill: { width: "100%", height: "100%" },
  banterPlaceholder: { flex: 1, backgroundColor: "#0f172a" },
  banterOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: "flex-end",
  },
  banterMeta: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  banterUser: { color: "#fff", fontSize: 18, fontWeight: "700" },
  banterHandle: { color: "#cbd5f5", marginBottom: 6 },
  banterText: { color: "#fff", lineHeight: 20 },
  banterTags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  banterTagText: { color: "#ff6b35", fontWeight: "700" },
  banterSideActions: {
    position: "absolute",
    right: 12,
    bottom: 120,
    alignItems: "center",
    gap: 16,
  },
  banterAction: { alignItems: "center", gap: 4 },
  banterActionText: { color: "#fff", fontSize: 12 },
  banterStayDropRow: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 20,
    flexDirection: "row",
    gap: 12,
  },
  banterStayBtn: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  banterDropBtn: {
    flex: 1,
    backgroundColor: "#1e3a8a",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  banterStayText: { color: "#fff", fontWeight: "700" },
  banterRepostLabel: { color: "#ff6b35", fontWeight: "700", marginBottom: 6 },
  repostBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  repostSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "25%",
    backgroundColor: "#151515",
    padding: 16,
    borderRadius: 16,
    borderColor: "#1f1f1f",
    borderWidth: 1,
  },
  repostTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  repostInput: {
    marginTop: 12,
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: "#0d0d0d",
    color: "#fff",
    padding: 12,
  },
  repostActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  repostBtn: {
    flex: 1,
    backgroundColor: "#1f1f1f",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  repostBtnText: { color: "#fff", fontWeight: "700" },
  repostBtnPrimary: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  repostBtnPrimaryText: { color: "#0d0d0d", fontWeight: "700" },
});
