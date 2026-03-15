import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  PanResponder,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  ToastAndroid,
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
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import { apiFetch } from "@/lib/api";
import { normalizeMediaUrl } from "@/lib/media";
import { formatRelativeTime } from "@/lib/time";
import { PendingPost, subscribePendingPosts } from "@/lib/uploadQueue";
import {
  getFollowStatus,
  setFollowStatus,
  subscribeFollowStatus,
} from "@/lib/followStore";
import { useFocusEffect } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { getSocket } from "@/lib/socket";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { FlashList } from "@shopify/flash-list";

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
  userReaction?: string | null;
  repostCount?: number;
  repostOf?: RepostOf | null;
  raw?: any;
};

const showToast = (message: string) => {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Notice", message);
  }
};

const ROAST_PREFIX = "[ROAST]";

const detectMediaType = (uri?: string | null) => {
  if (!uri) return undefined;
  const lower = uri.toLowerCase();
  if (lower.match(/\.(mp4|mov|m4v|webm|m3u8)$/)) return "video";
  return "image";
};

const normalizeMediaType = (raw?: string | null) => {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("video")) return "video";
  if (lower.includes("image")) return "image";
  return undefined;
};

const stripRoastPrefix = (content: string) =>
  content.replace(/^\[ROAST\]\s*/i, "");

export default function HomeFeed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const banterHeight = Math.max(360, windowHeight);
  const tabBarHeight = useBottomTabBarHeight();
  const [posts, setPosts] = useState<Post[]>([]);
  const [banters, setBanters] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<"posts" | "banter">("posts");
  const [postTab, setPostTab] = useState<"forYou" | "following">("forYou");
  const [banterTab, setBanterTab] = useState<"hot" | "following">("hot");
  const [meAvatar, setMeAvatar] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [activeBanterId, setActiveBanterId] = useState<string | null>(null);
  const lastActiveBanterIdRef = useRef<string | null>(null);
  const [repostTarget, setRepostTarget] = useState<Post | null>(null);
  const [quoteText, setQuoteText] = useState<string>("");
  const [showRepostModal, setShowRepostModal] = useState(false);
  const [banterCommentTarget, setBanterCommentTarget] = useState<Post | null>(null);
  const [banterComments, setBanterComments] = useState<any[]>([]);
  const [banterCommentText, setBanterCommentText] = useState("");
  const [banterCommentLoading, setBanterCommentLoading] = useState(false);
  const [banterCommentSubmitting, setBanterCommentSubmitting] = useState(false);
  const [videoProgress, setVideoProgress] = useState<
    Record<string, { position: number; duration: number }>
  >({});
  const [seekingVideoId, setSeekingVideoId] = useState<string | null>(null);
  const [seekBarWidthById, setSeekBarWidthById] = useState<Record<string, number>>(
    {}
  );
  const [seekFractionById, setSeekFractionById] = useState<Record<string, number>>(
    {}
  );
  const [isSeeking, setIsSeeking] = useState(false);
  const [commentReactions, setCommentReactions] = useState<Record<string, string>>(
    {}
  );
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const [commentActionTargetId, setCommentActionTargetId] = useState<string | null>(
    null
  );
  const [commentEditingId, setCommentEditingId] = useState<string | null>(null);
  const [commentEditText, setCommentEditText] = useState<string>("");
  const [commentComposerHeight, setCommentComposerHeight] = useState(56);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [replyTarget, setReplyTarget] = useState<any | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesByComment, setRepliesByComment] = useState<Record<string, any[]>>(
    {}
  );
  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([]);
  const [followedUserIds, setFollowedUserIds] = useState<Record<string, boolean>>(
    {}
  );
  const [followLoadingById, setFollowLoadingById] = useState<Record<string, boolean>>(
    {}
  );
  const commentSheetY = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef<Record<string, number>>({});
  const heartbeatScale = useRef(new Animated.Value(1)).current;
  const pendingCountRef = useRef(0);

  const commentEmojiOptions = ["😂", "🔥", "❤️", "👏", "😮", "😢"];
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const videoRefs = useRef<Map<string, Video>>(new Map());
  const lastSeekRef = useRef<Record<string, number>>({});
  const pauseAllVideos = useCallback(() => {
    videoRefs.current.forEach((ref) => {
      ref.pauseAsync().catch(() => {});
    });
  }, []);
  const resumeBanterVideo = useCallback((id?: string | null) => {
    if (!id) return;
    const ref = videoRefs.current.get(id);
    if (!ref) return;
    ref
      .getStatusAsync()
      .then((status) => {
        if (!status.isLoaded || status.isPlaying) return;
        ref.playAsync().catch(() => {});
      })
      .catch(() => {});
  }, []);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: Post; isViewable: boolean }> }) => {
      if (mainTab !== "banter") return;
      const next = viewableItems.find((v) => v.isViewable);
      if (next?.item?.id) setActiveBanterId(next.item.id);
    }
  ).current;

  const mapPost = (post: any): Post => {
    const isRoast =
      typeof post.content === "string" &&
      (post.isRoast || post.content.toUpperCase().startsWith(ROAST_PREFIX));
    const mediaUrl = normalizeMediaUrl(post.mediaUrl);
    const mediaType =
      normalizeMediaType(post.mediaType) || detectMediaType(mediaUrl);
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
      userReaction: post.userReaction ?? null,
      repostCount: post.repostCount ?? 0,
      repostOf: post.repostOf || null,
      raw: post,
    } as Post;
  };

  const pullFollowingFrom = (items: Post[]) => {
    const next: Record<string, boolean> = {};
    items.forEach((p) => {
      const userId = p.raw?.user?.id || p.raw?.userId;
      const isFollowing = p.raw?.user?.isFollowing ?? p.raw?.isFollowing;
      if (userId && typeof isFollowing === "boolean") {
        next[userId] = isFollowing;
        setFollowStatus(userId, isFollowing);
      }
    });
    return next;
  };

  const loadPosts = useCallback(async (type: "posts" | "banter", feed: string) => {
    try {
      setError(null);
      const data = await apiFetch(`/posts?type=${type}&feed=${feed}&page=1&limit=20`);
      const mapped = (data.posts || []).map(mapPost);
      if (type === "posts") {
        setPosts(mapped);
        setFollowedUserIds((prev) => ({ ...prev, ...pullFollowingFrom(mapped) }));
      } else {
        setBanters(mapped);
        setActiveBanterId(mapped[0]?.id || null);
        setFollowedUserIds((prev) => ({ ...prev, ...pullFollowingFrom(mapped) }));
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
      setMeId(user?.id || null);
    } catch {
      setMeAvatar(null);
      setMeId(null);
    }
  }, []);

  React.useEffect(() => {
    if (mainTab === "posts") {
      setActiveBanterId(null);
      loadPosts("posts", postTab);
    } else {
      loadPosts("banter", banterTab);
    }
    loadMe();
  }, [loadPosts, loadMe, mainTab, postTab, banterTab]);

  const applyReactionOptimistic = useCallback(
    (
      items: Post[],
      postId: string,
      type: "LOVE" | "ANGRY",
      currentReaction: string | null
    ) =>
      items.map((p) => {
        if (p.id !== postId) return p;
        const nextReaction = currentReaction === type ? null : type;
        const breakdown = { ...(p.reactionBreakdown || {}) } as Record<string, number>;
        let reactionCount = p.reactionCount || 0;

        if (currentReaction === type) {
          reactionCount = Math.max(0, reactionCount - 1);
          breakdown[type] = Math.max(0, (breakdown[type] || 0) - 1);
        } else if (!currentReaction) {
          reactionCount += 1;
          breakdown[type] = (breakdown[type] || 0) + 1;
        } else {
          breakdown[currentReaction] = Math.max(0, (breakdown[currentReaction] || 0) - 1);
          breakdown[type] = (breakdown[type] || 0) + 1;
        }

        return {
          ...p,
          reactionCount,
          reactionBreakdown: breakdown,
          userReaction: nextReaction,
        };
      }),
    []
  );

  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardHeight(event.endCoordinates?.height || 0);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = subscribePendingPosts((pending) => {
      setPendingPosts(pending);
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    const prevCount = pendingCountRef.current;
    pendingCountRef.current = pendingPosts.length;
    if (prevCount > 0 && pendingPosts.length === 0) {
      if (mainTab === "posts") {
        loadPosts("posts", postTab);
      } else {
        loadPosts("banter", banterTab);
      }
    }
  }, [pendingPosts, mainTab, postTab, banterTab, loadPosts]);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(heartbeatScale, {
          toValue: 1.12,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(heartbeatScale, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [heartbeatScale]);


  React.useEffect(() => {
    if (activeBanterId) {
      lastActiveBanterIdRef.current = activeBanterId;
    }
    videoRefs.current.forEach((ref, id) => {
      if (mainTab !== "banter") {
        ref.pauseAsync().catch(() => {});
        return;
      }
      if (activeBanterId && id === activeBanterId) {
        ref.playAsync().catch(() => {});
      } else {
        ref.pauseAsync().catch(() => {});
      }
    });
  }, [activeBanterId, mainTab]);

  React.useEffect(() => {
    const unsubscribe = subscribeFollowStatus((userId, isFollowing) => {
      setFollowedUserIds((prev) => ({ ...prev, [userId]: isFollowing }));
    });
    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (mainTab === "posts") {
        loadPosts("posts", postTab);
      } else {
        loadPosts("banter", banterTab);
      }
      loadMe();
      if (mainTab === "banter" && lastActiveBanterIdRef.current) {
        setActiveBanterId(lastActiveBanterIdRef.current);
      }
      return () => {
        pauseAllVideos();
      };
    }, [loadPosts, loadMe, mainTab, postTab, banterTab, pauseAllVideos])
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
      showToast(e.message || "Failed to vote");
    }
  };

  const handleFollowUser = async (userId: string) => {
    if (!userId || followLoadingById[userId]) return;
    try {
      setFollowLoadingById((prev) => ({ ...prev, [userId]: true }));
      const isFollowing = !!followedUserIds[userId] || !!getFollowStatus(userId);
      if (isFollowing) {
        await apiFetch(`/users/${userId}/follow`, { method: "DELETE" });
        setFollowedUserIds((prev) => ({ ...prev, [userId]: false }));
        setFollowStatus(userId, false);
      } else {
        setFollowedUserIds((prev) => ({ ...prev, [userId]: true }));
        setFollowStatus(userId, true);
        await apiFetch(`/users/${userId}/follow`, { method: "POST" });
      }
    } catch {
      setFollowedUserIds((prev) => ({ ...prev, [userId]: false }));
      setFollowStatus(userId, false);
    } finally {
      setFollowLoadingById((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const handleReaction = async (postId: string, type: "LOVE" | "ANGRY") => {
    try {
      const currentReaction =
        posts.find((p) => p.id === postId)?.userReaction ??
        banters.find((p) => p.id === postId)?.userReaction ??
        null;

      setPosts((current) =>
        applyReactionOptimistic(current, postId, type, currentReaction)
      );
      setBanters((current) =>
        applyReactionOptimistic(current, postId, type, currentReaction)
      );
      const data = await apiFetch("/reactions", {
        method: "POST",
        body: JSON.stringify({ postId, type }),
      });
      const reactionCount = data?.reactionCount;
      const reactionBreakdown = data?.reactionBreakdown;
      const serverReaction =
        data?.reaction?.type ??
        (data?.reaction === null ? null : currentReaction);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                reactionCount:
                  typeof reactionCount === "number" ? reactionCount : p.reactionCount,
                reactionBreakdown: reactionBreakdown || p.reactionBreakdown,
                userReaction: serverReaction ?? p.userReaction,
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
                userReaction: serverReaction ?? p.userReaction,
              }
            : p
        )
      );
    } catch (e: any) {
      showToast(e.message || "Failed to react");
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

      const onCommentDeleted = (payload: any) => {
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
      socket.on("comment-deleted", onCommentDeleted);
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
        socket.off("comment-deleted");
        socket.off("reaction-update");
        socket.off("share-update");
        socket.off("repost-update");
        socket.off("post-stays");
      }
    };
  }, []);

  const pendingPostItems = useMemo<Post[]>(() => {
    if (!pendingPosts.length) return [] as Post[];
    return pendingPosts.map<Post>((pending) => ({
      id: pending.id,
      name: "You",
      handle: "@you",
      time: "Uploading…",
      text: stripRoastPrefix(pending.content),
      type: pending.isRoast ? "roast" : "banter",
      media: pending.media,
      stayVotes: 0,
      dropVotes: 0,
      avatarUrl: meAvatar,
      tags: pending.tags || [],
      league: pending.league || null,
      commentCount: 0,
      reactionCount: 0,
      shareCount: 0,
      reactionBreakdown: {},
      repostCount: 0,
      repostOf: null,
      raw: { pending: true, isRoast: pending.isRoast, progress: pending.progress },
    }));
  }, [pendingPosts, meAvatar]);

  const visiblePosts = useMemo(() => {
    const normalPending = pendingPostItems.filter(
      (pending) => !pending.raw?.isRoast
    );
    return [...normalPending, ...posts];
  }, [pendingPostItems, posts]);

  const visibleBanters = useMemo(() => {
    const videoPending = pendingPostItems.filter(
      (pending) => pending.raw?.isRoast
    );
    return [...videoPending, ...banters];
  }, [pendingPostItems, banters]);
  const activeBanterIndex = useMemo(
    () => visibleBanters.findIndex((banter) => banter.id === activeBanterId),
    [visibleBanters, activeBanterId]
  );
  const handleBanterScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      if (mainTab !== "banter") return;
      const offsetY = event?.nativeEvent?.contentOffset?.y || 0;
      const index = Math.round(offsetY / banterHeight);
      const next = visibleBanters[index];
      if (next?.id && next.id !== activeBanterId) {
        setActiveBanterId(next.id);
      }
    },
    [activeBanterId, banterHeight, mainTab, visibleBanters]
  );

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

  const deletePost = async (postId: string, type: "posts" | "banter") => {
    try {
      await apiFetch(`/posts/${postId}`, { method: "DELETE" });
      if (type === "posts") {
        setPosts((prev) => prev.filter((post) => post.id !== postId));
      } else {
        setBanters((prev) => prev.filter((post) => post.id !== postId));
        setActiveBanterId((prev) => {
          if (prev !== postId) return prev;
          const remaining = banters.filter((post) => post.id !== postId);
          return remaining[0]?.id || null;
        });
      }
      showToast("Post deleted");
    } catch (e: any) {
      showToast(e.message || "Failed to delete post");
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

  const openBanterComments = async (item: Post) => {
    setBanterCommentTarget(item);
    setBanterCommentText(commentDrafts[item.id] || "");
    setCommentEditingId(null);
    setCommentEditText("");
    setReplyTarget(null);
    setBanterCommentLoading(true);
    try {
      const data = await apiFetch(`/comments/${item.id}?page=1&limit=50&includeReplies=1`);
      const comments = data.comments || [];
      setBanterComments(comments);
      const initialReactions: Record<string, string> = {};
      comments.forEach((comment: any) => {
        if (comment?.userReaction) {
          initialReactions[comment.id] = comment.userReaction;
        }
      });
      setCommentReactions(initialReactions);
    } catch {
      setBanterComments([]);
    } finally {
      setBanterCommentLoading(false);
    }
  };

  const closeBanterComments = () => {
    const nextId = banterCommentTarget?.id ?? null;
    if (banterCommentTarget?.id) {
      setActiveBanterId(banterCommentTarget.id);
      setCommentDrafts((prev) => ({
        ...prev,
        [banterCommentTarget.id]: banterCommentText,
      }));
    }
    setBanterCommentTarget(null);
    setBanterComments([]);
    setCommentEditingId(null);
    setCommentEditText("");
    setCommentActionTargetId(null);
    setReactionTargetId(null);
    setReplyTarget(null);
    commentSheetY.setValue(0);
    if (nextId) {
      setTimeout(() => resumeBanterVideo(nextId), 80);
    }
  };

  React.useEffect(() => {
    if (mainTab !== "banter") return;
    if (banterCommentTarget) return;
    if (!activeBanterId) return;
    const ref = videoRefs.current.get(activeBanterId);
    if (!ref) return;
    ref
      .getStatusAsync()
      .then((status) => {
        if (!status.isLoaded || status.isPlaying) return;
        ref.playAsync().catch(() => {});
      })
      .catch(() => {});
  }, [banterCommentTarget, activeBanterId, mainTab]);

  const submitBanterComment = async () => {
    if (!banterCommentTarget) return;
    if (commentEditingId) {
      if (!commentEditText.trim()) return;
      setBanterCommentSubmitting(true);
      try {
        const data = await apiFetch(`/comments/${commentEditingId}`, {
          method: "PATCH",
          body: JSON.stringify({ content: commentEditText.trim() }),
        });
        const updated = data.comment || data;
        setBanterComments((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
        );
        setCommentEditingId(null);
        setCommentEditText("");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBanterCommentSubmitting(false);
      }
      return;
    }
    if (!banterCommentText.trim()) return;
    setBanterCommentSubmitting(true);
    try {
      const data = await apiFetch("/comments", {
        method: "POST",
        body: JSON.stringify({
          postId: banterCommentTarget.id,
          content: banterCommentText.trim(),
          parentId: replyTarget?.id ?? null,
        }),
      });
      const created = data.comment || data;
      setBanterComments((prev) => {
        const exists = prev.some((c) => c.id === created.id);
        return exists ? prev : [...prev, created];
      });
      if (typeof data?.commentCount === "number") {
        setBanters((prev) =>
          prev.map((p) =>
            p.id === banterCommentTarget.id ? { ...p, commentCount: data.commentCount } : p
          )
        );
      }
      setBanterCommentText("");
      setReplyTarget(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBanterCommentSubmitting(false);
    }
  };

  const loadReplies = async (commentId: string) => {
    try {
      const data = await apiFetch(`/comments/replies/${commentId}?page=1&limit=20`);
      const replies = data.replies || [];
      setRepliesByComment((prev) => ({
        ...prev,
        [commentId]: replies,
      }));
      setCommentReactions((prev) => {
        const next = { ...prev };
        replies.forEach((reply: any) => {
          if (reply?.userReaction) {
            next[reply.id] = reply.userReaction;
          }
        });
        return next;
      });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCommentEmoji = async (commentId: string, emoji: string) => {
    const prevEmoji = commentReactions[commentId] || null;
    const nextEmoji = prevEmoji === emoji ? null : emoji;
    setCommentReactions((prev) => {
      const next = { ...prev };
      if (nextEmoji) {
        next[commentId] = nextEmoji;
      } else {
        delete next[commentId];
      }
      return next;
    });
    setReactionTargetId(null);
    try {
      const data = await apiFetch(`/comments/${commentId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      const serverEmoji =
        data?.reaction?.emoji ?? (data?.reaction === null ? null : nextEmoji);
      setCommentReactions((prev) => {
        const next = { ...prev };
        if (serverEmoji) {
          next[commentId] = serverEmoji;
        } else {
          delete next[commentId];
        }
        return next;
      });
    } catch (e: any) {
      setCommentReactions((prev) => {
        const next = { ...prev };
        if (prevEmoji) {
          next[commentId] = prevEmoji;
        } else {
          delete next[commentId];
        }
        return next;
      });
      showToast(e?.message || "Failed to react to comment");
    }
  };

  const handleCommentPress = (commentId: string) => {
    setReactionTargetId(null);
    setCommentActionTargetId(null);
    const now = Date.now();
    const lastTap = lastTapRef.current[commentId] || 0;
    if (now - lastTap < 320) {
      setCommentReactions((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    }
    lastTapRef.current[commentId] = now;
  };

  const deleteComment = async (commentId: string) => {
    try {
      await apiFetch(`/comments/${commentId}`, { method: "DELETE" });
      setBanterComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentActionTargetId(null);
    } catch (e: any) {
      setError(e.message);
    }
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
    const ownerId = item.raw?.user?.id || item.raw?.userId;
    const isMine = !!meId && ownerId === meId;
    const isFollowing = ownerId
      ? followedUserIds[ownerId] ?? getFollowStatus(ownerId) ?? false
      : false;
    const loveCount = item.reactionBreakdown?.LOVE ?? 0;
    const dislikeCount = item.reactionBreakdown?.ANGRY ?? 0;
    const loveActive = item.userReaction === "LOVE";
    const dislikeActive = item.userReaction === "ANGRY";
    const isRepost = !!item.repostOf;
    const original = item.repostOf;
    const originalMediaUrl = normalizeMediaUrl(original?.mediaUrl);
    const repostAvatarUrl = normalizeMediaUrl(original?.user?.avatarUrl);
    const originalMediaType =
      normalizeMediaType(original?.mediaType) || detectMediaType(originalMediaUrl);
    const originalMedia = originalMediaUrl
      ? {
          type: originalMediaType as "image" | "video",
          uri: originalMediaUrl,
          ratio: 16 / 9,
        }
      : null;

    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          if (item.raw?.pending) {
            showToast("Still uploading. Please wait.");
            return;
          }
          router.push(`/post/${item.id}`);
        }}
      >
        <View style={styles.row}>
          <Pressable
            style={styles.avatarWrap}
            onPress={(e) => {
              e.stopPropagation?.();
              if (!ownerId) return;
              pauseAllVideos();
              if (isMine) {
                router.push("/(tabs)/profile");
              } else {
                router.push(`/user/${ownerId}`);
              }
            }}
          >
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
          </Pressable>
          <View style={{ flex: 1 }}>
            {isRepost ? (
              <Text style={styles.repostLabel}>
                {original?.isRoast ? "Rebantered" : "Reposted"} by {item.handle}
              </Text>
            ) : null}
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                if (!ownerId) return;
                pauseAllVideos();
                if (isMine) {
                  router.push("/(tabs)/profile");
                } else {
                  router.push(`/user/${ownerId}`);
                }
              }}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.handle}>
                {item.handle} - {item.time}
              </Text>
            </Pressable>
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
                <View style={styles.repostHeader}>
                  {repostAvatarUrl ? (
                    <ExpoImage
                      source={{ uri: repostAvatarUrl }}
                      style={styles.repostAvatar}
                      contentFit="cover"
                      transition={180}
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={styles.repostAvatar} />
                  )}
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
                </View>
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
                onPress={() => openBanterComments(item)}
              >
                <FontAwesome name="comment-o" size={16} color="#9ca3af" />
                <Text style={styles.actionText}>{item.commentCount ?? 0}</Text>
              </Pressable>
              {item.raw?.pending ? (
                <View style={styles.pendingPill}>
                  <Text style={styles.pendingText}>
                    {typeof item.raw?.progress === "number"
                      ? `Uploading ${item.raw.progress}%`
                      : "Uploading…"}
                  </Text>
                </View>
              ) : null}
              <Pressable
                style={styles.actionItem}
                onPress={() => openRepostModal(item)}
              >
                <FontAwesome name="retweet" size={16} color="#9ca3af" />
                <Text style={styles.actionText}>{item.repostCount ?? 0}</Text>
              </Pressable>
              <Pressable
                style={styles.actionItem}
                onPress={() => handleReaction(item.id, "LOVE")}
              >
                <FontAwesome
                  name="heart"
                  size={16}
                  color={loveActive ? "#ef4444" : "#9ca3af"}
                />
                <Text style={styles.actionText}>{loveCount}</Text>
              </Pressable>
              <Pressable
                style={styles.actionItem}
                onPress={() => handleReaction(item.id, "ANGRY")}
              >
                <FontAwesome
                  name="thumbs-down"
                  size={16}
                  color={dislikeActive ? "#f59e0b" : "#9ca3af"}
                />
                <Text style={styles.actionText}>{dislikeCount}</Text>
              </Pressable>
              <Pressable style={styles.actionItem} onPress={() => handleShare(item)}>
                <FontAwesome name="share-alt" size={16} color="#9ca3af" />
                <Text style={styles.actionText}>{item.shareCount ?? 0}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderBanterItem = ({ item, index }: { item: Post; index: number }) => {
    const ownerId = item.raw?.user?.id || item.raw?.userId;
    const isMine = !!meId && ownerId === meId;
    const isFollowing = ownerId
      ? followedUserIds[ownerId] ?? getFollowStatus(ownerId) ?? false
      : false;
    const loveCount = item.reactionBreakdown?.LOVE ?? 0;
    const dislikeCount = item.reactionBreakdown?.ANGRY ?? 0;
    const loveActive = item.userReaction === "LOVE";
    const dislikeActive = item.userReaction === "ANGRY";
    const media = item.media;
    const isVideo = media?.type === "video";
    const isRepost = !!item.repostOf;
    const controlsPad = isVideo ? 56 : 0;
    const stayDropBottom = 12 + insets.bottom + 20 + controlsPad + (isVideo ? 30 : 0);
    const sideActionsBottom = stayDropBottom + 96;
    const metaBottom = stayDropBottom + 120;
    const banterActionIconSize = 30;
    const isSheetOpen = !!banterCommentTarget;
    const seekBarThumbSize = 12;
    const seekBarWidth = seekBarWidthById[item.id] ?? 0;
    const preloadAhead = 4;
    const preloadBehind = 1;
    const withinWindow =
      activeBanterIndex === -1
        ? index === 0
        : index >= activeBanterIndex - preloadBehind &&
          index <= activeBanterIndex + preloadAhead;
    const showSeekBar = false;

      const captionParts = [
        item.text?.trim() || "",
        ...(item.tags || []).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
      ].filter(Boolean);
      const caption = captionParts.join(" ");
      const progress = videoProgress[item.id];
      const progressDuration = progress?.duration ?? 0;
      const progressPosition = progress?.position ?? 0;
      const fallbackFraction = seekFractionById[item.id];
      const computedProgress =
        progressDuration > 0 ? Math.min(1, progressPosition / progressDuration) : 0;
      const progressValue =
        seekingVideoId === item.id
          ? fallbackFraction ?? computedProgress
          : progressDuration > 0
          ? computedProgress
          : fallbackFraction ?? 0;

    return (
      <View
        style={[
          styles.banterCard,
          { height: banterHeight },
          isSheetOpen && activeBanterId === item.id && styles.banterCardShrunk,
        ]}
      >
        <View style={[styles.banterMedia, isVideo && { paddingBottom: tabBarHeight }]}>
          {media ? (
            isVideo ? (
              withinWindow ? (
                <Video
                  key={`${item.id}-${media.uri}`}
                  source={{ uri: media.uri }}
                  style={styles.banterMediaFill}
                  resizeMode={ResizeMode.COVER}
                  shouldPlay={activeBanterId === item.id && mainTab === "banter" && !isSheetOpen}
                  isLooping
                  useNativeControls={false}
                  isMuted={false}
                  volume={1.0}
                  onPlaybackStatusUpdate={(status) => {
                    if (!status.isLoaded) return;
                    if (seekingVideoId === item.id) return;
                    const nextPosition = status.positionMillis ?? 0;
                    const nextDuration = status.durationMillis ?? 0;
                    setVideoProgress((prev) => ({
                      ...prev,
                      [item.id]: { position: nextPosition, duration: nextDuration },
                    }));
                  }}
                  ref={(ref) => {
                    if (ref) {
                      videoRefs.current.set(item.id, ref);
                    } else {
                      videoRefs.current.delete(item.id);
                    }
                  }}
                />
              ) : (
                <View style={styles.banterPlaceholder} />
              )
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
        </View>
        <View style={styles.banterOverlay} pointerEvents="box-none">
          <View style={[styles.banterMeta, { paddingBottom: metaBottom }]}>
            {isRepost ? (
              <Text style={styles.banterRepostLabel}>
                {item.repostOf?.isRoast ? "Rebantered" : "Reposted"} by {item.handle}
              </Text>
            ) : null}
            <View style={styles.banterUserRow}>
              <Pressable
                style={styles.banterAvatarWrap}
                onPress={() => ownerId && router.push(`/user/${ownerId}`)}
              >
                {item.avatarUrl ? (
                  <ExpoImage
                    source={{ uri: item.avatarUrl }}
                    style={styles.banterAvatar}
                    contentFit="cover"
                    transition={180}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={styles.banterAvatar} />
                )}
                {!isMine && !isFollowing ? (
                  <Pressable
                    style={[
                      styles.banterAvatarPlus,
                      followLoadingById[ownerId] && styles.banterAvatarPlusLoading,
                    ]}
                    onPress={() => ownerId && !isFollowing && handleFollowUser(ownerId)}
                    hitSlop={10}
                    disabled={followLoadingById[ownerId] || isFollowing}
                  >
                    <Text style={styles.banterAvatarPlusText}>+</Text>
                  </Pressable>
                ) : null}
              </Pressable>
              <Text style={styles.banterUser}>{item.handle}</Text>
            </View>
            {item.raw?.pending ? (
              <View style={styles.pendingPillBanter}>
                <Text style={styles.pendingText}>
                  {typeof item.raw?.progress === "number"
                    ? `Uploading ${item.raw.progress}%`
                    : "Uploading…"}
                </Text>
              </View>
            ) : null}
            {caption ? (
              <Text style={styles.banterCaption} numberOfLines={2}>
                {caption}
              </Text>
            ) : null}
          </View>
          <View style={[styles.banterSideActions, { bottom: sideActionsBottom }]}>
            {isMine ? (
              <Pressable
                style={styles.banterAction}
                onPress={() => deletePost(item.id, "banter")}
              >
                <FontAwesome name="trash" size={banterActionIconSize} color="#fff" />
                <Text style={styles.banterActionText}>Delete</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.banterAction}
              onPress={() => openBanterComments(item)}
            >
              <FontAwesome name="comment-o" size={banterActionIconSize} color="#fff" />
              <Text style={styles.banterActionText}>{item.commentCount ?? 0}</Text>
            </Pressable>
            <Pressable style={styles.banterAction} onPress={() => openRepostModal(item)}>
              <FontAwesome name="retweet" size={banterActionIconSize} color="#fff" />
              <Text style={styles.banterActionText}>{item.repostCount ?? 0}</Text>
            </Pressable>
            <Pressable
              style={styles.banterAction}
              onPress={() => handleReaction(item.id, "LOVE")}
            >
              <FontAwesome
                name="heart"
                size={banterActionIconSize}
                color={loveActive ? "#ef4444" : "#fff"}
              />
              <Text style={styles.banterActionText}>{loveCount}</Text>
            </Pressable>
            <Pressable
              style={styles.banterAction}
              onPress={() => handleReaction(item.id, "ANGRY")}
            >
              <FontAwesome
                name="thumbs-down"
                size={banterActionIconSize}
                color={dislikeActive ? "#f59e0b" : "#fff"}
              />
              <Text style={styles.banterActionText}>{dislikeCount}</Text>
            </Pressable>
            <Pressable style={styles.banterAction} onPress={() => handleShare(item)}>
              <FontAwesome name="share-alt" size={banterActionIconSize} color="#fff" />
              <Text style={styles.banterActionText}>{item.shareCount ?? 0}</Text>
            </Pressable>
          </View>
          {showSeekBar ? (
            <View
              style={[styles.banterSeekBarWrap, { bottom: stayDropBottom + 54 }]}
              pointerEvents="box-only"
              onStartShouldSetResponderCapture={() => true}
              onMoveShouldSetResponderCapture={() => true}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={(evt) => {
                if (!seekBarWidth) return;
                setIsSeeking(true);
                if (activeBanterId !== item.id) {
                  setActiveBanterId(item.id);
                }
                const ref = videoRefs.current.get(item.id);
                if (ref) {
                  ref.pauseAsync().catch(() => {});
                }
                setSeekingVideoId(item.id);
                const fraction = Math.max(
                  0,
                  Math.min(1, evt.nativeEvent.locationX / seekBarWidth)
                );
                setSeekFractionById((prev) => ({ ...prev, [item.id]: fraction }));
                if (progressDuration) {
                  const nextPosition = fraction * progressDuration;
                  setVideoProgress((prev) => ({
                    ...prev,
                    [item.id]: { position: nextPosition, duration: progressDuration },
                  }));
                  if (ref) {
                    ref
                      .setStatusAsync({ positionMillis: nextPosition, shouldPlay: false })
                      .catch(() => {});
                  }
                  return;
                }
                if (!ref) return;
                ref.getStatusAsync().then((status) => {
                  if (!status.isLoaded || !status.durationMillis) return;
                  const nextPosition = fraction * status.durationMillis;
                  setVideoProgress((prev) => ({
                    ...prev,
                    [item.id]: {
                      position: nextPosition,
                      duration: status.durationMillis ?? prev[item.id]?.duration ?? 0,
                    },
                  }));
                  ref
                    .setStatusAsync({ positionMillis: nextPosition, shouldPlay: false })
                    .catch(() => {});
                });
              }}
              onResponderMove={(evt) => {
                if (!seekBarWidth) return;
                const fraction = Math.max(
                  0,
                  Math.min(1, evt.nativeEvent.locationX / seekBarWidth)
                );
                setSeekFractionById((prev) => ({ ...prev, [item.id]: fraction }));
                if (progressDuration) {
                  const nextPosition = fraction * progressDuration;
                  setVideoProgress((prev) => ({
                    ...prev,
                    [item.id]: { position: nextPosition, duration: progressDuration },
                  }));
                }
                const now = Date.now();
                const lastSeek = lastSeekRef.current[item.id] ?? 0;
                if (now - lastSeek > 80) {
                  const ref = videoRefs.current.get(item.id);
                  if (!ref) return;
                  if (progressDuration) {
                    const nextPosition = fraction * progressDuration;
                    ref
                      .setStatusAsync({ positionMillis: nextPosition, shouldPlay: false })
                      .catch(() => {});
                  } else {
                    ref.getStatusAsync().then((status) => {
                      if (!status.isLoaded || !status.durationMillis) return;
                      const nextPosition = fraction * status.durationMillis;
                      setVideoProgress((prev) => ({
                        ...prev,
                        [item.id]: {
                          position: nextPosition,
                          duration: status.durationMillis ?? prev[item.id]?.duration ?? 0,
                        },
                      }));
                      ref
                        .setStatusAsync({ positionMillis: nextPosition, shouldPlay: false })
                        .catch(() => {});
                    });
                  }
                  lastSeekRef.current[item.id] = now;
                }
              }}
              onResponderRelease={(evt) => {
                if (!seekBarWidth) {
                  setSeekingVideoId(null);
                  setIsSeeking(false);
                  return;
                }
                const ref = videoRefs.current.get(item.id);
                const fraction = Math.max(
                  0,
                  Math.min(1, evt.nativeEvent.locationX / seekBarWidth)
                );
                setSeekFractionById((prev) => ({ ...prev, [item.id]: fraction }));
                const finishPlay = (nextPosition: number, duration: number) => {
                  setVideoProgress((prev) => ({
                    ...prev,
                    [item.id]: { position: nextPosition, duration },
                  }));
                  setSeekingVideoId(null);
                  setIsSeeking(false);
                  if (!ref) return;
                  ref
                    .setStatusAsync({ positionMillis: nextPosition, shouldPlay: true })
                    .catch(() => {
                      ref.playAsync().catch(() => {});
                    });
                };
                if (ref) {
                  if (progressDuration) {
                    finishPlay(fraction * progressDuration, progressDuration);
                  } else {
                    ref.getStatusAsync().then((status) => {
                      if (!status.isLoaded || !status.durationMillis) {
                        setSeekingVideoId(null);
                        ref.playAsync().catch(() => {});
                        return;
                      }
                      finishPlay(fraction * status.durationMillis, status.durationMillis);
                    });
                  }
                } else {
                  setSeekingVideoId(null);
                  setIsSeeking(false);
                }
              }}
              onResponderTerminate={() => {
                const ref = videoRefs.current.get(item.id);
                if (ref) {
                  ref.playAsync().catch(() => {});
                }
                setSeekingVideoId(null);
                setIsSeeking(false);
              }}
            >
              <View
                style={styles.banterSeekBar}
                onLayout={(event) => {
                  const width = event?.nativeEvent?.layout?.width;
                  if (!width) return;
                  setSeekBarWidthById((prev) => ({
                    ...prev,
                    [item.id]: width,
                  }));
                }}
              >
                <View
                  style={[styles.banterSeekBarFill, { width: `${progressValue * 100}%` }]}
                />
                <View
                  style={[
                    styles.banterSeekBarThumb,
                    {
                      width: seekBarThumbSize,
                      height: seekBarThumbSize,
                      borderRadius: seekBarThumbSize / 2,
                      left: Math.max(
                        0,
                        Math.min(
                          seekBarWidth - seekBarThumbSize,
                          progressValue * seekBarWidth - seekBarThumbSize / 2
                        )
                      ),
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
          <View
            style={[
              styles.banterStayDropWrap,
              { bottom: stayDropBottom },
              isVideo && styles.banterStayDropWrapCompact,
            ]}
            pointerEvents="auto"
          >
            <View style={[styles.banterGauge, isVideo && styles.banterGaugeCompact]}>
              <VoteGauge stayVotes={item.stayVotes} dropVotes={item.dropVotes} />
            </View>
            <View style={styles.banterStayDropRow}>
              <Pressable
                style={[styles.banterStayBtn, isVideo && styles.banterStayBtnCompact]}
                onPress={() => handleVote(item.id, "STAY")}
                hitSlop={10}
              >
                <Text style={[styles.banterStayText, isVideo && styles.banterStayTextCompact]}>
                  Stay
                </Text>
              </Pressable>
              <Pressable
                style={[styles.banterDropBtn, isVideo && styles.banterStayBtnCompact]}
                onPress={() => handleVote(item.id, "DROP")}
                hitSlop={10}
              >
                <Text style={[styles.banterStayText, isVideo && styles.banterStayTextCompact]}>
                  Drop
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <View
          style={[
            styles.headerStack,
            mainTab === "banter" && styles.headerStackOverlay,
          ]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.topBar,
              mainTab === "banter" && styles.topBarOverlay,
            ]}
          >
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
            <View
              style={[
                styles.mainTabs,
                mainTab === "banter" && styles.tabsOverlay,
              ]}
            >
              <Pressable onPress={() => setMainTab("posts")}>
                <Text
                  style={[
                    styles.mainTab,
                    mainTab === "posts" && styles.mainTabActive,
                    mainTab === "banter" && styles.tabOverlayText,
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
                    mainTab === "banter" && styles.tabOverlayText,
                  ]}
                >
                  Banter
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome name="cog" size={18} color="#fff" />
            </Pressable>
          </View>

          <View
            style={[
              styles.subTabs,
              mainTab === "banter" && styles.tabsOverlay,
            ]}
          >
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
                    style={[
                      styles.tab,
                      banterTab === "hot" && styles.tabActive,
                      styles.tabOverlayText,
                    ]}
                  >
                    Trending
                  </Text>
                </Pressable>
                <Pressable onPress={() => setBanterTab("following")}>
                  <Text
                    style={[
                      styles.tab,
                      banterTab === "following" && styles.tabActive,
                      styles.tabOverlayText,
                    ]}
                  >
                    Following
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {error ? (
          <View style={styles.errorToast}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {loading ? (
          <CenteredHeartbeatLoader
            visible
            text={mainTab === "posts" ? "Loading posts..." : "Loading banter..."}
          />
        ) : null}

        {mainTab === "posts" ? (
          <FlashList
            data={visiblePosts}
            keyExtractor={(item) => item.id}
            renderItem={renderPostItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={{ paddingBottom: 100 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="transparent"
                colors={["transparent"]}
                progressBackgroundColor="transparent"
              />
            }
            estimatedItemSize={520}
            drawDistance={windowHeight * 2}
            viewabilityConfig={viewabilityConfig.current}
            onViewableItemsChanged={onViewableItemsChanged}
          />
        ) : (
            <FlashList
              data={visibleBanters}
              keyExtractor={(item) => item.id}
              renderItem={renderBanterItem}
              extraData={{ followedUserIds, followLoadingById, meId }}
              pagingEnabled
              decelerationRate="fast"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 0 }}
              snapToInterval={banterHeight}
              snapToAlignment="start"
              onScroll={handleBanterScroll}
              scrollEventThrottle={16}
              scrollEnabled={!isSeeking}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor="transparent"
                  colors={["transparent"]}
                  progressBackgroundColor="transparent"
                />
              }
              estimatedItemSize={banterHeight}
              drawDistance={windowHeight * 2}
              viewabilityConfig={viewabilityConfig.current}
              onViewableItemsChanged={onViewableItemsChanged}
              onMomentumScrollEnd={(event) => {
                const offsetY = event.nativeEvent.contentOffset.y || 0;
                const index = Math.round(offsetY / banterHeight);
                const next = visibleBanters[index];
                if (next?.id) setActiveBanterId(next.id);
              }}
            />
        )}

        {mainTab === "posts" ? (
          <Pressable
            style={styles.fab}
            onPress={() => router.push("/(tabs)/compose")}
          >
            <FontAwesome name="plus" size={20} color="#0d0d0d" />
          </Pressable>
        ) : null}

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
        {banterCommentTarget ? (
          <Modal transparent animationType="fade" visible>
            <View style={styles.commentModal}>
              <Pressable
                style={styles.commentBackdrop}
                onPress={closeBanterComments}
              />
              <KeyboardAvoidingView
                style={styles.commentKeyboard}
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                keyboardVerticalOffset={0}
                pointerEvents="box-none"
              >
                <Animated.View
                  style={[
                    styles.commentSheet,
                    {
                      paddingBottom: 12 + insets.bottom,
                      transform: [{ translateY: commentSheetY }],
                    },
                  ]}
                >
                  <View
                    style={styles.commentHeaderRow}
                    {...PanResponder.create({
                      onMoveShouldSetPanResponder: (_, gesture) =>
                        Math.abs(gesture.dy) > 6,
                      onPanResponderMove: (_, gesture) => {
                        if (gesture.dy > 0) {
                          commentSheetY.setValue(gesture.dy);
                        }
                      },
                      onPanResponderRelease: (_, gesture) => {
                        if (gesture.dy > 120 || gesture.vy > 1.2) {
                          closeBanterComments();
                        } else {
                          Animated.spring(commentSheetY, {
                            toValue: 0,
                            useNativeDriver: true,
                          }).start();
                        }
                      },
                    }).panHandlers}
                  >
                    <Text style={styles.commentTitle}>Comments</Text>
                    <Text style={styles.commentCountText}>
                      {banterComments.length}
                    </Text>
                  </View>
                  {banterCommentLoading ? (
                    <View style={styles.commentLoading}>
                      <ActivityIndicator />
                    </View>
                  ) : (
                  <FlatList
                    data={banterComments}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item, index }) => (
                      (() => {
                        const ownerId = item.user?.id || item.userId;
                        const isMine = !!meId && ownerId === meId;
                        const reactionBarStyle =
                          index < 2
                            ? styles.commentReactionBarBelow
                            : styles.commentReactionBarAbove;
                        return (
                          <Pressable
                            style={styles.commentRow}
                            onPress={() => handleCommentPress(item.id)}
                            delayLongPress={200}
                            onLongPress={() => {
                              setReactionTargetId(item.id);
                              setCommentActionTargetId(null);
                            }}
                          >
                            {reactionTargetId === item.id ? (
                              <View style={[styles.commentReactionBar, reactionBarStyle]}>
                                {commentEmojiOptions.map((emoji) => (
                                  <Pressable
                                    key={`${item.id}-react-${emoji}`}
                                    style={styles.commentReactionEmoji}
                                    onPress={() => handleCommentEmoji(item.id, emoji)}
                                  >
                                    <Text style={styles.commentReactionEmojiText}>
                                      {emoji}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            ) : null}
                            {item.user?.avatarUrl ? (
                              <ExpoImage
                                source={{
                                  uri: normalizeMediaUrl(item.user.avatarUrl),
                                }}
                                style={styles.commentAvatar}
                                contentFit="cover"
                                transition={120}
                                cachePolicy="memory-disk"
                              />
                            ) : (
                              <View style={styles.commentAvatar} />
                            )}
                            <View style={{ flex: 1 }}>
                              <View style={styles.commentHeader}>
                                <Text style={styles.commentName}>
                                  {item.user?.displayName ||
                                    item.user?.username ||
                                    "User"}
                                </Text>
                                {isMine ? (
                                  <Pressable
                                    style={styles.commentActionToggle}
                                    onPress={() =>
                                      setCommentActionTargetId((prev) =>
                                        prev === item.id ? null : item.id
                                      )
                                    }
                                  >
                                    <FontAwesome
                                      name="ellipsis-h"
                                      size={14}
                                      color="#9ca3af"
                                    />
                                  </Pressable>
                                ) : null}
                                {commentActionTargetId === item.id ? (
                                  <View style={styles.commentActionInline}>
                                    <Pressable
                                      style={styles.commentActionBtn}
                                      onPress={() => {
                                        setCommentEditingId(item.id);
                                        setCommentEditText(item.content || "");
                                        setCommentActionTargetId(null);
                                      }}
                                    >
                                      <Text style={styles.commentActionText}>
                                        Edit
                                      </Text>
                                    </Pressable>
                                    <Pressable
                                      style={[
                                        styles.commentActionBtn,
                                        styles.commentDeleteBtn,
                                      ]}
                                      onPress={() => deleteComment(item.id)}
                                    >
                                      <Text style={styles.commentActionText}>
                                        Delete
                                      </Text>
                                    </Pressable>
                                  </View>
                                ) : null}
                              </View>
                              <Text style={styles.commentText}>
                                {item.content}
                              </Text>
                              <View style={styles.commentMetaRow}>
                                <Text style={styles.commentMetaText}>
                                  {formatRelativeTime(item.createdAt)}
                                </Text>
                                <Pressable
                                  onPress={() => setReplyTarget(item)}
                                  style={styles.commentReplyBtn}
                                >
                                  <Text style={styles.commentReplyText}>Reply</Text>
                                </Pressable>
                              </View>
                              {item.replyCount > 0 ? (
                                <Pressable
                                  style={styles.commentRepliesToggle}
                                  onPress={() => {
                                    const expanded = !!expandedReplies[item.id];
                                    setExpandedReplies((prev) => ({
                                      ...prev,
                                      [item.id]: !expanded,
                                    }));
                                    if (!expanded && !repliesByComment[item.id]) {
                                      loadReplies(item.id);
                                    }
                                  }}
                                >
                                  <Text style={styles.commentRepliesText}>
                                    {expandedReplies[item.id]
                                      ? "Hide replies"
                                      : `View ${item.replyCount} replies`}
                                  </Text>
                                </Pressable>
                              ) : null}
                              {expandedReplies[item.id] &&
                              (repliesByComment[item.id] || item.replies) ? (
                                <View style={styles.commentRepliesWrap}>
                                  {(repliesByComment[item.id] ||
                                    item.replies ||
                                    []).map((reply: any) => (
                                    <View key={reply.id} style={styles.replyRow}>
                                      {reply.user?.avatarUrl ? (
                                        <ExpoImage
                                          source={{
                                            uri: normalizeMediaUrl(
                                              reply.user.avatarUrl
                                            ),
                                          }}
                                          style={styles.replyAvatar}
                                          contentFit="cover"
                                          transition={120}
                                          cachePolicy="memory-disk"
                                        />
                                      ) : (
                                        <View style={styles.replyAvatar} />
                                      )}
                                      <View style={{ flex: 1 }}>
                                        <Text style={styles.replyName}>
                                          {reply.user?.displayName ||
                                            reply.user?.username ||
                                            "User"}
                                        </Text>
                                        <Text style={styles.replyText}>
                                          {reply.content}
                                        </Text>
                                      </View>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                              {commentReactions[item.id] ? (
                                <View style={styles.commentReactionBadge}>
                                  <Text style={styles.commentReactionBadgeText}>
                                    {commentReactions[item.id]}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })()
                    )}
                    contentContainerStyle={[
                      styles.commentListContent,
                      {
                        paddingBottom:
                          commentComposerHeight +
                          16 +
                          Math.max(0, keyboardHeight - tabBarHeight),
                      },
                    ]}
                    keyboardShouldPersistTaps="handled"
                  />
                  )}
                  <View
                    style={[
                      styles.commentComposer,
                      {
                        bottom: 12 + insets.bottom + keyboardHeight,
                      },
                    ]}
                    onLayout={(event) =>
                      setCommentComposerHeight(event.nativeEvent.layout.height)
                    }
                  >
                    <TextInput
                      style={styles.commentInput}
                      placeholder={
                        commentEditingId
                          ? "Edit your comment..."
                          : replyTarget
                          ? `Reply to @${
                              replyTarget.user?.username ||
                              replyTarget.user?.displayName ||
                              "user"
                            }...`
                          : "Write a comment..."
                      }
                      placeholderTextColor="#777"
                      value={commentEditingId ? commentEditText : banterCommentText}
                      onChangeText={
                        commentEditingId ? setCommentEditText : setBanterCommentText
                      }
                    />
                    <Pressable
                      style={styles.commentSend}
                      onPress={submitBanterComment}
                      disabled={banterCommentSubmitting}
                    >
                      {banterCommentSubmitting ? (
                        <ActivityIndicator color="#0d0d0d" />
                      ) : (
                        <Text style={styles.commentSendText}>
                          {commentEditingId ? "Update" : "Send"}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                  {replyTarget ? (
                    <Pressable
                      style={styles.commentCancel}
                      onPress={() => setReplyTarget(null)}
                    >
                      <Text style={styles.commentCancelText}>
                        Cancel reply
                      </Text>
                    </Pressable>
                  ) : null}
                  {commentEditingId ? (
                    <Pressable
                      style={styles.commentCancel}
                      onPress={() => {
                        setCommentEditingId(null);
                        setCommentEditText("");
                      }}
                    >
                      <Text style={styles.commentCancelText}>Cancel edit</Text>
                    </Pressable>
                  ) : null}
                </Animated.View>
              </KeyboardAvoidingView>
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
  topBarOverlay: {
    backgroundColor: "transparent",
    borderBottomWidth: 0,
  },
  brand: { color: "#fff", fontWeight: "700", fontSize: 18 },
  brandSpacer: { width: 60 },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#1f1f1f",
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  mainTabs: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    justifyContent: "center",
    flex: 1,
  },
  headerStack: {
    zIndex: 20,
  },
  headerStackOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
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
    justifyContent: "center",
  },
  tabsOverlay: {
    backgroundColor: "transparent",
    borderBottomWidth: 0,
  },
  tabOverlayText: {
    color: "rgba(255,255,255,0.85)",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    fontWeight: "600",
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
    borderWidth: 1,
    borderColor: "#ff6b35",
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
  actionText: { color: "#9ca3af", fontSize: 13 },
  pendingPill: {
    backgroundColor: "rgba(255,107,53,0.15)",
    borderColor: "rgba(255,107,53,0.35)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "center",
  },
  pendingPillBanter: {
    backgroundColor: "rgba(255,107,53,0.2)",
    borderColor: "rgba(255,107,53,0.45)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  pendingText: { color: "#ffb08a", fontSize: 11, fontWeight: "700" },
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
  errorToast: {
    position: "absolute",
    top: "45%",
    left: 24,
    right: 24,
    backgroundColor: "rgba(0,0,0,0.85)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    zIndex: 50,
  },
  errorText: { color: "#ff6b35", fontSize: 12, textAlign: "center" },
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
  repostHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  repostAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#1f1f1f",
    borderWidth: 1,
    borderColor: "#ff6b35",
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
  banterCardShrunk: {
    transform: [{ scale: 0.92 }, { translateY: -8 }],
    borderRadius: 16,
    overflow: "hidden",
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
  banterUserRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  banterAvatarWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  banterAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  banterAvatarPlus: {
    position: "absolute",
    bottom: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ff6b35",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#0d0d0d",
  },
  banterAvatarPlusText: {
    color: "#0d0d0d",
    fontWeight: "800",
    fontSize: 14,
    lineHeight: 14,
  },
  banterAvatarPlusLoading: {
    opacity: 0.6,
  },
  banterUser: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  banterCaption: {
    color: "rgba(255,255,255,0.85)",
    marginTop: 6,
    lineHeight: 18,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  banterSideActions: {
    position: "absolute",
    right: 12,
    bottom: 120,
    alignItems: "center",
    gap: 16,
  },
  banterSeekBarWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    height: 24,
    justifyContent: "center",
    zIndex: 6,
  },
  banterSeekBar: {
    width: "100%",
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  banterSeekBarFill: {
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  banterSeekBarThumb: {
    position: "absolute",
    top: -4,
    backgroundColor: "#fff",
  },
  banterStayDropWrap: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 20,
      alignItems: "center",
      gap: 6,
      zIndex: 8,
      elevation: 8,
    },
  banterStayDropWrapCompact: {
    gap: 4,
  },
  banterGauge: {
    width: "62%",
  },
  banterGaugeCompact: {
    width: "54%",
  },
    banterAction: { alignItems: "center", gap: 3 },
    banterActionText: { color: "#fff", fontSize: 12 },
  banterStayDropRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  banterStayBtn: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  banterStayBtnCompact: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  banterDropBtn: {
    flex: 1,
    backgroundColor: "#1e3a8a",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  banterStayText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  banterStayTextCompact: { fontSize: 11 },
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
  commentModal: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  commentBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  commentKeyboard: {
    flex: 1,
    justifyContent: "flex-end",
  },
  commentSheet: {
    position: "relative",
    height: "80%",
    backgroundColor: "#0d0d0d",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderColor: "#1f1f1f",
    borderWidth: 1,
    padding: 16,
  },
  commentListContent: {
    paddingBottom: 12,
  },
  commentHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  commentCountText: { color: "#9ca3af", fontSize: 12 },
  commentTitle: { color: "#fff", fontWeight: "700", fontSize: 16 },
  commentLoading: { paddingVertical: 16, alignItems: "center" },
  commentRow: {
    position: "relative",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderBottomColor: "#1f1f1f",
    borderBottomWidth: 1,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1f1f1f",
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  commentName: { color: "#fff", fontWeight: "700" },
  commentText: { color: "#cbd5f5", marginTop: 2 },
  commentMetaRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
    alignItems: "center",
  },
  commentMetaText: { color: "#9ca3af", fontSize: 12 },
  commentReplyBtn: { paddingVertical: 2 },
  commentReplyText: { color: "#9ca3af", fontSize: 12, fontWeight: "600" },
  commentRepliesToggle: {
    marginTop: 6,
  },
  commentRepliesText: { color: "#ff6b35", fontSize: 12, fontWeight: "600" },
  commentRepliesWrap: {
    marginTop: 8,
    paddingLeft: 8,
    borderLeftColor: "#1f1f1f",
    borderLeftWidth: 1,
    gap: 8,
  },
  replyRow: {
    flexDirection: "row",
    gap: 8,
  },
  replyAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#1f1f1f",
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  replyName: { color: "#e5e7eb", fontWeight: "600", fontSize: 12 },
  replyText: { color: "#cbd5f5", marginTop: 2, fontSize: 12 },
  commentComposer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopColor: "#1f1f1f",
    borderTopWidth: 1,
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "rgba(13,13,13,0.92)",
    borderRadius: 16,
    paddingHorizontal: 12,
    zIndex: 30,
  },
  commentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  commentActionToggle: {
    paddingHorizontal: 6,
    paddingVertical: 2,
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
  commentReactionBar: {
    position: "absolute",
    right: 10,
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#111",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderColor: "#1f1f1f",
    borderWidth: 1,
    zIndex: 20,
    elevation: 20,
  },
  commentReactionBarAbove: {
    top: -40,
  },
  commentReactionBarBelow: {
    top: 44,
  },
  commentReactionEmoji: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#151515",
    alignItems: "center",
    justifyContent: "center",
  },
  commentReactionEmojiText: { color: "#fff", fontSize: 14 },
  commentReactionBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "#151515",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  commentReactionBadgeText: { color: "#fff", fontSize: 12 },
  commentActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#151515",
  },
  commentDeleteBtn: {
    backgroundColor: "#3f1d1d",
  },
  commentActionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  commentActionInline: {
    flexDirection: "row",
    gap: 6,
    marginLeft: 8,
  },
  commentCancel: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  commentCancelText: { color: "#9ca3af", fontSize: 12 },
});
