import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  LayoutChangeEvent,
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
import { AppThemeColors, useAppThemeColors } from "@/components/theme";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { useRouter } from "expo-router";
import VoteGauge from "@/components/VoteGauge";
import CenteredHeartbeatLoader from "@/components/CenteredHeartbeatLoader";
import ImageCarousel from "@/components/ImageCarousel";
import { apiFetch } from "@/lib/api";
import {
  normalizeMediaUrl,
  resolvePlayableMediaUrl,
  saveMediaToLibrary,
} from "@/lib/media";
import { formatRelativeTime } from "@/lib/time";
import { PendingPost, removePendingPost, subscribePendingPosts } from "@/lib/uploadQueue";
import {
  getFollowStatus,
  setFollowStatus,
  subscribeFollowStatus,
} from "@/lib/followStore";
import { useFocusEffect } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { getSocket } from "@/lib/socket";
import { FlashList } from "@shopify/flash-list";
import * as Linking from "expo-linking";

type RepostOf = {
  id: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  mediaItems?: Array<{ url: string; type: "image" | "video" }> | null;
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

type MediaItem = {
  type: "image" | "video";
  uri: string;
  ratio?: number;
};

type Post = {
  id: string;
  name: string;
  handle: string;
  time: string;
  text: string;
  media?: MediaItem;
  mediaItems?: MediaItem[];
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

type AdPlacement = "POST_FEED" | "BANTER_FEED";

type AdCampaign = {
  id: string;
  title: string;
  body?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  targetUrl?: string | null;
  ctaLabel?: string | null;
  placement: AdPlacement;
};

type AdSettings = {
  postFrequency: number;
  banterFrequency: number;
  isEnabled: boolean;
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

const buildMediaItems = (
  rawMediaItems: unknown,
  fallbackUrl?: string | null,
  fallbackType?: string | null
): MediaItem[] => {
  const normalized: MediaItem[] = [];
  if (Array.isArray(rawMediaItems)) {
    rawMediaItems.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const rawUrl = normalizeMediaUrl((item as any).url);
      const rawType =
        normalizeMediaType((item as any).type) || detectMediaType(rawUrl);
      const playableUrl = rawType === "video" ? resolvePlayableMediaUrl(rawUrl) : rawUrl;
      if (!playableUrl || !rawType) return;
      normalized.push({
        type: rawType as "image" | "video",
        uri: playableUrl,
        ratio: 16 / 9,
      });
    });
  }

  if (normalized.length) return normalized;

  const normalizedFallbackUrl = normalizeMediaUrl(fallbackUrl);
  const mediaType = normalizeMediaType(fallbackType) || detectMediaType(normalizedFallbackUrl);
  const mediaUrl = mediaType === "video" ? resolvePlayableMediaUrl(normalizedFallbackUrl) : normalizedFallbackUrl;
  if (!mediaUrl || !mediaType) return [];

  return [
    {
      type: mediaType as "image" | "video",
      uri: mediaUrl,
      ratio: 16 / 9,
    },
  ];
};

const stripRoastPrefix = (content: string) =>
  content.replace(/^\[ROAST\]\s*/i, "");

type ThreadedComment = {
  id: string;
  createdAt?: string | null;
  replyCount?: number;
  replies?: ThreadedComment[];
  [key: string]: any;
};

const sortThreadedComments = <T extends { createdAt?: string | null }>(items: T[]) =>
  [...items].sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return left - right;
  });

const mergeThreadedItems = <T extends { id: string; createdAt?: string | null }>(
  items: T[],
  incoming: T
) => {
  const index = items.findIndex((item) => item.id === incoming.id);
  const next =
    index === -1
      ? [...items, incoming]
      : items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...incoming } : item
        );
  return sortThreadedComments(next);
};

const attachReplyToThread = <T extends ThreadedComment>(
  comments: T[],
  parentId: string,
  reply: T
) =>
  comments.map((comment) =>
    comment.id !== parentId
      ? comment
      : {
          ...comment,
          replyCount: Math.max(comment.replyCount ?? 0, (comment.replies?.length ?? 0) + 1),
          replies: mergeThreadedItems((comment.replies || []) as T[], reply),
        }
  );

const updateThreadedItem = <T extends ThreadedComment>(comments: T[], updated: T) =>
  comments.map((comment) => {
    if (comment.id === updated.id) {
      return { ...comment, ...updated };
    }
    if (comment.replies?.some((reply) => reply.id === updated.id)) {
      return {
        ...comment,
        replies: mergeThreadedItems((comment.replies || []) as T[], updated),
      };
    }
    return comment;
  });

const removeThreadedItem = <T extends ThreadedComment>(comments: T[], targetId: string) => {
  const topLevelRemoved = comments.some((comment) => comment.id === targetId);
  if (topLevelRemoved) {
    return comments.filter((comment) => comment.id !== targetId);
  }

  return comments.map((comment) => {
    const existingReplies = (comment.replies || []) as T[];
    if (!existingReplies.some((reply) => reply.id === targetId)) {
      return comment;
    }
    const nextReplies = existingReplies.filter((reply) => reply.id !== targetId);
    return {
      ...comment,
      replies: nextReplies,
      replyCount: Math.max(0, nextReplies.length),
    };
  });
};

const PostsFeedPane = React.memo(function PostsFeedPane({
  visible,
  visiblePosts,
  refreshing,
  handleRefresh,
  renderPostItem,
  windowHeight,
}: {
  visible: boolean;
  visiblePosts: Post[];
  refreshing: boolean;
  handleRefresh: () => void;
  renderPostItem: ({ item }: { item: Post }) => React.ReactElement | null;
  windowHeight: number;
}) {
  return (
    <View
      style={{ flex: 1, display: visible ? "flex" : "none" }}
      pointerEvents={visible ? "auto" : "none"}
    >
      <FlashList
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        renderItem={renderPostItem}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "transparent" }} />}
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
        drawDistance={Math.round(windowHeight * 1.5)}
      />
    </View>
  );
});

const BanterFeedPane = React.memo(function BanterFeedPane({
  visible,
  visibleBanters,
  renderBanterItem,
  banterHeight,
  refreshing,
  handleRefresh,
  handleBanterScroll,
  isSeeking,
  viewabilityConfig,
  onViewableItemsChanged,
  onMomentumScrollEnd,
  windowHeight,
}: {
  visible: boolean;
  visibleBanters: Post[];
  renderBanterItem: ({ item, index }: { item: Post; index: number }) => React.ReactElement | null;
  banterHeight: number;
  refreshing: boolean;
  handleRefresh: () => void;
  handleBanterScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  isSeeking: boolean;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
  onViewableItemsChanged: ({
    viewableItems,
  }: {
    viewableItems: Array<{ item: Post; isViewable: boolean }>;
  }) => void;
  onMomentumScrollEnd: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  windowHeight: number;
}) {
  return (
    <View
      style={{ flex: 1, display: visible ? "flex" : "none" }}
      pointerEvents={visible ? "auto" : "none"}
    >
      <FlashList
        data={visibleBanters}
        keyExtractor={(item) => item.id}
        renderItem={renderBanterItem}
        style={{ height: banterHeight }}
        pagingEnabled
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 0 }}
        snapToInterval={banterHeight}
        snapToAlignment="start"
        onScroll={handleBanterScroll}
        scrollEventThrottle={16}
        scrollEnabled={visible && !isSeeking}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressBackgroundColor="transparent"
          />
        }
        drawDistance={Math.round(windowHeight)}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onMomentumScrollEnd={onMomentumScrollEnd}
      />
    </View>
  );
});

export default function HomeFeed() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const [feedViewportHeight, setFeedViewportHeight] = useState<number | null>(null);
  const banterHeight = Math.max(
    360,
    Math.round(feedViewportHeight || (windowHeight - tabBarHeight))
  );
  const postMediaHeight = Math.min(Math.max(windowHeight * 0.5, 300), 520);
  const themeColors = useAppThemeColors();
  const styles = useMemo(
    () => createStyles(themeColors, postMediaHeight),
    [themeColors, postMediaHeight]
  );
  const [posts, setPosts] = useState<Post[]>([]);
  const [banters, setBanters] = useState<Post[]>([]);
  const [adSettings, setAdSettings] = useState<AdSettings | null>(null);
  const [postAds, setPostAds] = useState<AdCampaign[]>([]);
  const [banterAds, setBanterAds] = useState<AdCampaign[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
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
  const loadedFeedKeysRef = useRef<{ posts: string | null; banter: string | null }>({
    posts: null,
    banter: null,
  });
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
  const [downloadingMediaUri, setDownloadingMediaUri] = useState<string | null>(null);
  const [expandedMediaUri, setExpandedMediaUri] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const commentSheetY = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef<Record<string, number>>({}); 
  const heartbeatScale = useRef(new Animated.Value(1)).current;
  const pendingCountRef = useRef(0);

  const commentEmojiOptions = ["😂", "🔥", "❤️", "👏", "😮", "😢"];
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });
  const videoRefs = useRef<Map<string, Video>>(new Map());
  const inlineVideoRefs = useRef<Map<string, Video>>(new Map());
  const lastSeekRef = useRef<Record<string, number>>({});
  const pauseAllVideos = useCallback(() => {
    videoRefs.current.forEach((ref) => {
      ref.pauseAsync().catch(() => {});
    });
    inlineVideoRefs.current.forEach((ref) => {
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
  const handleFeedViewportLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = Math.round(event.nativeEvent.layout.height || 0);
      if (!nextHeight) return;
      setFeedViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    },
    []
  );

  const mapPost = (post: any): Post => {
    const isRoast =
      typeof post.content === "string" &&
      (post.isRoast || post.content.toUpperCase().startsWith(ROAST_PREFIX));
    const mediaItems = buildMediaItems(post.mediaItems, post.mediaUrl, post.mediaType);
    const avatarUrl = normalizeMediaUrl(post.user?.avatarUrl);
    return {
      id: post.id,
      name: post.user?.displayName || post.user?.username || "Banter",
      handle: post.user?.username ? `@${post.user.username}` : "@banter",
      time: formatRelativeTime(post.createdAt),
      text: stripRoastPrefix(post.content || ""),
      type: isRoast ? "roast" : "banter",
      media: mediaItems[0],
      mediaItems,
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

  const mapAdToPost = (ad: AdCampaign): Post => {
    const mediaItems = buildMediaItems([], ad.mediaUrl || "", ad.mediaType || null);
    return {
      id: `ad-${ad.id}`,
      name: ad.title || "Sponsored",
      handle: "Sponsored",
      time: "Sponsored",
      text: ad.body || "",
      type: "banter",
      media: mediaItems[0],
      mediaItems,
      stayVotes: 0,
      dropVotes: 0,
      avatarUrl: null,
      tags: [],
      league: null,
      commentCount: 0,
      reactionCount: 0,
      shareCount: 0,
      reactionBreakdown: {},
      userReaction: null,
      repostCount: 0,
      repostOf: null,
      raw: { isAd: true, ad },
    } as Post;
  };

  const loadAds = useCallback(async () => {
    try {
      setAdsLoading(true);
      const [postRes, banterRes] = await Promise.all([
        apiFetch("/ads?placement=POST_FEED", undefined, false),
        apiFetch("/ads?placement=BANTER_FEED", undefined, false),
      ]);
      setAdSettings((postRes?.settings || banterRes?.settings || null) as AdSettings | null);
      setPostAds(postRes?.ads || []);
      setBanterAds(banterRes?.ads || []);
    } catch {
      // ignore ads errors
    } finally {
      setAdsLoading(false);
    }
  }, []);

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
      void loadAds();
      const mapped = (data.posts || []).map(mapPost);
      if (type === "posts") {
        setPosts(mapped);
        loadedFeedKeysRef.current.posts = feed;
        setFollowedUserIds((prev) => ({ ...prev, ...pullFollowingFrom(mapped) }));
      } else {
        setBanters(mapped);
        loadedFeedKeysRef.current.banter = feed;
        setActiveBanterId(mapped[0]?.id || null);
        setFollowedUserIds((prev) => ({ ...prev, ...pullFollowingFrom(mapped) }));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadAds]);

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
    }
    if (loadedFeedKeysRef.current.posts !== postTab || posts.length === 0) {
      loadPosts("posts", postTab);
    }
    if (loadedFeedKeysRef.current.banter !== banterTab || banters.length === 0) {
      loadPosts("banter", banterTab);
    }
    if (!meId) {
      loadMe();
    }
  }, [loadPosts, loadMe, mainTab, postTab, banterTab, posts.length, banters.length, meId]);

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
        if (!posts.length) {
          loadPosts("posts", postTab);
        }
      } else {
        if (!banters.length) {
          loadPosts("banter", banterTab);
        }
      }
      if (!meId) {
        loadMe();
      }
      if (mainTab === "banter" && lastActiveBanterIdRef.current) {
        setActiveBanterId(lastActiveBanterIdRef.current);
      }
      return () => {
        pauseAllVideos();
      };
    }, [loadPosts, loadMe, mainTab, postTab, banterTab, pauseAllVideos, posts.length, banters.length, meId])
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
    if (downloadingMediaUri === uri) return;
    setDownloadingMediaUri(uri);
    showToast("Downloading...");
    try {
      await saveMediaToLibrary(uri);
      showToast("Saved to gallery.");
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Could not save media.");
    } finally {
      setDownloadingMediaUri((current) => (current === uri ? null : current));
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
      mediaItems: pending.mediaItems || (pending.media ? [pending.media] : []),
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
      raw: {
        pending: true,
        isRoast: pending.isRoast,
        progress: pending.progress,
        ownedByViewer: true,
        userId: meId,
      },
    }));
  }, [pendingPosts, meAvatar, meId]);

  const injectAds = useCallback(
    (items: Post[], ads: AdCampaign[], frequency: number | undefined) => {
      if (!adSettings?.isEnabled) return items;
      if (!ads?.length) return items;
      const slot = Number(frequency || 0);
      if (!Number.isFinite(slot) || slot <= 0) return items;
      const result: Post[] = [];
      let adIndex = 0;
      items.forEach((item, idx) => {
        result.push(item);
        if ((idx + 1) % slot === 0) {
          const ad = ads[adIndex % ads.length];
          if (ad) {
            result.push(mapAdToPost(ad));
            adIndex += 1;
          }
        }
      });
      if (adIndex === 0 && items.length > 0) {
        result.push(mapAdToPost(ads[0]));
      }
      return result;
    },
    [adSettings?.isEnabled, mapAdToPost]
  );

  const visiblePosts = useMemo(() => {
    const normalPending = pendingPostItems.filter(
      (pending) => !pending.raw?.isRoast
    );
    const injected = injectAds(posts, postAds, adSettings?.postFrequency);
    return [...normalPending, ...injected];
  }, [pendingPostItems, posts, injectAds, postAds, adSettings?.postFrequency]);

  const visibleBanters = useMemo(() => {
    const videoPending = pendingPostItems.filter(
      (pending) => pending.raw?.isRoast
    );
    const injected = injectAds(banters, banterAds, adSettings?.banterFrequency);
    return [...videoPending, ...injected];
  }, [pendingPostItems, banters, injectAds, banterAds, adSettings?.banterFrequency]);
  const activeOwnedBanter = useMemo(() => {
    if (!activeBanterId) return null;
    const current = visibleBanters.find((banter) => banter.id === activeBanterId) ?? null;
    if (!current) return null;
    if (current.raw?.adCampaignId) return null;
    const ownerId = current.raw?.user?.id || current.raw?.userId;
    const isMine = current.raw?.ownedByViewer === true || (!!meId && ownerId === meId);
    return isMine ? current : null;
  }, [visibleBanters, activeBanterId, meId]);
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
    if (deletingPostId === postId) return;
    try {
      setDeletingPostId(postId);
      if (postId.startsWith("pending-")) {
        removePendingPost(postId);
        if (type === "banter") {
          setBanters((prev) => prev.filter((post) => post.id !== postId));
          setActiveBanterId((prev) => (prev === postId ? null : prev));
        } else {
          setPosts((prev) => prev.filter((post) => post.id !== postId));
        }
        showToast("Pending post removed");
        return;
      }
      showToast("Deleting...");
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
    } finally {
      setDeletingPostId((current) => (current === postId ? null : current));
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
      const comments = sortThreadedComments(data.comments || []);
      setBanterComments(comments);
      const initialReactions: Record<string, string> = {};
      const initialReplies: Record<string, any[]> = {};
      comments.forEach((comment: any) => {
        if (comment?.userReaction) {
          initialReactions[comment.id] = comment.userReaction;
        }
        if (Array.isArray(comment?.replies) && comment.replies.length) {
          initialReplies[comment.id] = sortThreadedComments(comment.replies);
        }
      });
      setCommentReactions(initialReactions);
      setRepliesByComment(initialReplies);
    } catch {
      setBanterComments([]);
      setRepliesByComment({});
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
    setExpandedReplies({});
    setRepliesByComment({});
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
      if (replyTarget?.id) {
        setBanterComments((prev) => attachReplyToThread(prev, replyTarget.id, created));
        setRepliesByComment((prev) => ({
          ...prev,
          [replyTarget.id]: mergeThreadedItems(prev[replyTarget.id] || [], created),
        }));
        setExpandedReplies((prev) => ({ ...prev, [replyTarget.id]: true }));
      } else {
        setBanterComments((prev) => mergeThreadedItems(prev, created));
      }
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
      const replies = sortThreadedComments(data.replies || []);
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
      setBanterComments((prev) => removeThreadedItem(prev, commentId));
      setRepliesByComment((prev) => {
        const next = { ...prev };
        delete next[commentId];
        Object.keys(next).forEach((parentId) => {
          next[parentId] = next[parentId].filter((reply) => reply.id !== commentId);
        });
        return next;
      });
      setCommentActionTargetId(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const renderSingleMedia = (
    media: MediaItem,
    allowDownload: boolean
  ) => {
    const isDownloading = downloadingMediaUri === media.uri;
    if (media.type === "video") {
      return (
        <View style={[styles.mediaWrapper, styles.mediaFrame]}>
                  <Video
                    source={{ uri: media.uri }}
                    style={styles.mediaFill}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={false}
                    useNativeControls
                    ref={(ref) => {
                      if (ref) {
                        inlineVideoRefs.current.set(media.uri, ref);
                      } else {
                        inlineVideoRefs.current.delete(media.uri);
                      }
                    }}
                  />
          {allowDownload ? (
            <Pressable
              style={[styles.mediaDownload, isDownloading && styles.mediaDownloadBusy]}
              onPress={() => downloadMedia(media.uri)}
                disabled={isDownloading}
                hitSlop={12}
            >
                {isDownloading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <FontAwesome name="download" size={20} color="#fff" />
                )}
            </Pressable>
          ) : null}
        </View>
      );
    }

    return (
      <View style={[styles.mediaWrapper, styles.mediaFrame]}>
        <Pressable style={styles.mediaFill} onPress={() => setExpandedMediaUri(media.uri)}>
          <ExpoImage
            source={{ uri: media.uri }}
            style={styles.mediaFill}
            contentFit="cover"
            contentPosition="center"
            transition={180}
            cachePolicy="memory-disk"
          />
        </Pressable>
      </View>
    );
  };

  const renderMedia = (mediaItems: MediaItem[], allowDownload: boolean) => {
    if (!mediaItems.length) return null;
    if (mediaItems.length === 1 || mediaItems.some((item) => item.type === "video")) {
      return renderSingleMedia(mediaItems[0], allowDownload);
    }
    return (
      <View style={[styles.mediaWrapper, styles.mediaFrame]}>
        <ImageCarousel
          items={mediaItems.map((item) => ({ uri: item.uri }))}
          height={postMediaHeight}
          onDownload={allowDownload ? downloadMedia : undefined}
          downloadingUri={downloadingMediaUri}
          onPressItem={(uri) => setExpandedMediaUri(uri)}
        />
      </View>
    );
  };

  const renderPostItem = ({ item }: { item: Post }) => {
    if (item.raw?.isAd) {
      const ad = item.raw?.ad as AdCampaign | undefined;
      const ctaLabel = ad?.ctaLabel || "Learn more";
      return (
        <Pressable
          style={styles.adCard}
          onPress={async () => {
            if (!ad?.targetUrl) return;
            try {
              await Linking.openURL(ad.targetUrl);
            } catch {
              showToast("Unable to open link.");
            }
          }}
        >
          <View style={styles.adHeader}>
            <Text style={styles.adBadge}>Sponsored</Text>
            <Text style={styles.adTitle}>{ad?.title || "Banter Sponsor"}</Text>
          </View>
          {item.text ? <Text style={styles.adBody}>{item.text}</Text> : null}
          {item.mediaItems?.length ? renderMedia(item.mediaItems, true) : null}
          {ad?.targetUrl ? (
            <View style={styles.adCtaRow}>
              <Text style={styles.adCtaText}>{ctaLabel}</Text>
              <FontAwesome name="external-link" size={12} color="#0d0d0d" />
            </View>
          ) : null}
        </Pressable>
      );
    }
    const isRoast = item.type === "roast";
    const ownerId = item.raw?.user?.id || item.raw?.userId;
    const isMine = item.raw?.ownedByViewer === true || (!!meId && ownerId === meId);
    const isFollowing = ownerId
      ? followedUserIds[ownerId] ?? getFollowStatus(ownerId) ?? false
      : false;
    const loveCount = item.reactionBreakdown?.LOVE ?? 0;
    const dislikeCount = item.reactionBreakdown?.ANGRY ?? 0;
    const loveActive = item.userReaction === "LOVE";
    const dislikeActive = item.userReaction === "ANGRY";
    const isRepost = !!item.repostOf;
    const original = item.repostOf;
    const originalMediaItems = buildMediaItems(
      original?.mediaItems,
      original?.mediaUrl,
      original?.mediaType || null
    );
    const repostAvatarUrl = normalizeMediaUrl(original?.user?.avatarUrl);

    return (
      <Pressable
        style={styles.card}
        onPress={() => {
          if (item.raw?.pending) {
            showToast("Still uploading. Please wait.");
            return;
          }
          pauseAllVideos();
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
            {item.mediaItems?.length ? renderMedia(item.mediaItems, true) : null}
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
                {originalMediaItems.length ? renderMedia(originalMediaItems, true) : null}
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
                style={[
                  styles.actionItem,
                  loveActive && styles.reactionActiveLove,
                ]}
                onPress={() => handleReaction(item.id, "LOVE")}
              >
                <FontAwesome
                  name={loveActive ? "heart" : "heart-o"}
                  size={16}
                  color={loveActive ? "#f59e0b" : "#9ca3af"}
                />
                <Text
                  style={[styles.actionText, loveActive ? { color: "#f59e0b" } : null]}
                >
                  {loveCount}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.actionItem,
                  dislikeActive && styles.reactionActiveDislike,
                ]}
                onPress={() => handleReaction(item.id, "ANGRY")}
              >
                <FontAwesome
                  name={dislikeActive ? "thumbs-down" : "thumbs-o-down"}
                  size={16}
                  color={dislikeActive ? "#ef4444" : "#9ca3af"}
                />
                <Text
                  style={[styles.actionText, dislikeActive ? { color: "#ef4444" } : null]}
                >
                  {dislikeCount}
                </Text>
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
    if (item.raw?.isAd) {
      const ad = item.raw?.ad as AdCampaign | undefined;
      const media = item.media;
      const isVideo = media?.type === "video";
      const isSheetOpen = !!banterCommentTarget;
      const withinWindow =
        activeBanterIndex === -1
          ? index === 0
          : index >= activeBanterIndex - 1 && index <= activeBanterIndex + 2;
      const ctaLabel = ad?.ctaLabel || "Learn more";
      return (
        <View
          style={[
            styles.banterCard,
            { height: banterHeight },
            isSheetOpen && activeBanterId === item.id && styles.banterCardShrunk,
          ]}
        >
          <View style={styles.banterMedia}>
            {media ? (
              isVideo ? (
	                withinWindow ? (
	                  <>
	                    <Video
	                      key={`${item.id}-${media.uri}`}
	                      source={{ uri: media.uri }}
	                      style={styles.banterMediaFill}
	                      resizeMode={ResizeMode.COVER}
	                      shouldPlay={activeBanterId === item.id && mainTab === "banter" && !isSheetOpen}
	                      isLooping
	                      useNativeControls
	                      isMuted={false}
	                      volume={1.0}
	                      ref={(ref) => {
	                        if (ref) {
	                          videoRefs.current.set(item.id, ref);
	                        } else {
	                          videoRefs.current.delete(item.id);
	                        }
	                      }}
	                    />
	                  </>
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
          <View style={styles.adBanterOverlay}>
            <Text style={styles.adBadgeBanter}>Sponsored</Text>
            <Text style={styles.adBanterTitle}>{ad?.title || "Banter Sponsor"}</Text>
            {item.text ? <Text style={styles.adBanterBody}>{item.text}</Text> : null}
	            {ad?.targetUrl ? (
	              <Pressable
	                style={styles.adBanterCta}
	                onPress={async () => {
	                  try {
	                    const targetUrl = ad?.targetUrl;
	                    if (!targetUrl) return;
	                    await Linking.openURL(targetUrl);
	                  } catch {
	                    showToast("Unable to open link.");
	                  }
                }}
              >
                <Text style={styles.adBanterCtaText}>{ctaLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      );
    }
    const ownerId = item.raw?.user?.id || item.raw?.userId;
    const isMine = item.raw?.ownedByViewer === true || (!!meId && ownerId === meId);
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
    const nativeControlsHeight = isVideo ? 74 : 0;
    const stayDropBottom = 10 + nativeControlsHeight;
    const sideActionsBottom = stayDropBottom + 82;
    const metaBottom = stayDropBottom + 104;
    const banterActionIconSize = 34;
    const isSheetOpen = !!banterCommentTarget;
    const seekBarThumbSize = 12;
    const seekBarWidth = seekBarWidthById[item.id] ?? 0;
    const preloadAhead = 2;
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
        <View style={styles.banterMedia}>
          {media ? (
            isVideo ? (
	              withinWindow ? (
	                <>
	                  <Video
	                    key={`${item.id}-${media.uri}`}
	                    source={{ uri: media.uri }}
	                    style={styles.banterMediaFill}
	                    resizeMode={ResizeMode.COVER}
	                    shouldPlay={activeBanterId === item.id && mainTab === "banter" && !isSheetOpen}
	                    isLooping
	                    useNativeControls
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
	                </>
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
              style={[
                styles.banterAction,
                loveActive && styles.banterReactionActiveLove,
              ]}
              onPress={() => handleReaction(item.id, "LOVE")}
            >
              <FontAwesome
                name={loveActive ? "heart" : "heart-o"}
                size={banterActionIconSize}
                color={loveActive ? "#f59e0b" : "#fff"}
              />
              <Text
                style={[
                  styles.banterActionText,
                  loveActive ? { color: "#f59e0b" } : null,
                ]}
              >
                {loveCount}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.banterAction,
                dislikeActive && styles.banterReactionActiveDislike,
              ]}
              onPress={() => handleReaction(item.id, "ANGRY")}
            >
              <FontAwesome
                name={dislikeActive ? "thumbs-down" : "thumbs-o-down"}
                size={banterActionIconSize}
                color={dislikeActive ? "#ef4444" : "#fff"}
              />
              <Text
                style={[
                  styles.banterActionText,
                  dislikeActive ? { color: "#ef4444" } : null,
                ]}
              >
                {dislikeCount}
              </Text>
            </Pressable>
            {media ? (
              <Pressable
                style={[styles.banterAction, downloadingMediaUri === media.uri && styles.banterActionBusy]}
                onPress={() => downloadMedia(media.uri)}
                disabled={downloadingMediaUri === media.uri}
                hitSlop={12}
              >
                {downloadingMediaUri === media.uri ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <FontAwesome name="download" size={banterActionIconSize} color="#fff" />
                )}
                <Text style={styles.banterActionText}>
                  {downloadingMediaUri === media.uri ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.banterAction} onPress={() => handleShare(item)}>
              <FontAwesome name="share-alt" size={banterActionIconSize} color="#fff" />
              <Text style={styles.banterActionText}>{item.shareCount ?? 0}</Text>
            </Pressable>
          </View>
          {showSeekBar ? (
            <View
              style={[styles.banterSeekBarWrap, { bottom: stayDropBottom + 42 }]}
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
              <Pressable
                hitSlop={14}
                onPress={() => {
                  pauseAllVideos();
                  setActiveBanterId(null);
                  setMainTab("posts");
                }}
              >
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
              <Pressable
                hitSlop={14}
                onPress={() => {
                  pauseAllVideos();
                  setMainTab("banter");
                }}
              >
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
		            <View style={styles.topBarActionSlot}>
		              {mainTab === "banter" && activeOwnedBanter ? (
		                <Pressable
		                  onPress={() => deletePost(activeOwnedBanter.id, "banter")}
		                  hitSlop={12}
		                  style={styles.topBarDeleteButton}
		                  disabled={deletingPostId === activeOwnedBanter.id}
		                >
		                  {deletingPostId === activeOwnedBanter.id ? (
		                    <ActivityIndicator size="small" color="#fff" />
		                  ) : (
		                    <FontAwesome name="trash" size={24} color="#fff" />
		                  )}
		                </Pressable>
		              ) : (
		                <View style={styles.topBarActionPlaceholder} />
		              )}
	            </View>
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

        <View style={styles.feedViewport} onLayout={handleFeedViewportLayout}>
          <PostsFeedPane
            visible={mainTab === "posts"}
            visiblePosts={visiblePosts}
            refreshing={refreshing && mainTab === "posts"}
            handleRefresh={handleRefresh}
            renderPostItem={renderPostItem}
            windowHeight={windowHeight}
          />

          <BanterFeedPane
            visible={mainTab === "banter"}
            visibleBanters={visibleBanters}
            renderBanterItem={renderBanterItem}
            banterHeight={banterHeight}
            refreshing={refreshing && mainTab === "banter"}
            handleRefresh={handleRefresh}
            handleBanterScroll={handleBanterScroll}
            isSeeking={isSeeking}
            viewabilityConfig={viewabilityConfig.current}
            onViewableItemsChanged={onViewableItemsChanged}
            onMomentumScrollEnd={(event) => {
              const offsetY = event.nativeEvent.contentOffset.y || 0;
              const index = Math.round(offsetY / banterHeight);
              const next = visibleBanters[index];
              if (next?.id) setActiveBanterId(next.id);
            }}
            windowHeight={windowHeight}
          />
        </View>

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

        {expandedMediaUri ? (
          <Modal transparent animationType="fade" visible>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setExpandedMediaUri(null)}
            />
            <View style={styles.modalContent}>
              <ExpoImage
                source={{ uri: expandedMediaUri }}
                style={styles.modalImage}
                contentFit="contain"
                transition={180}
                cachePolicy="memory-disk"
              />
            </View>
            <View style={[styles.modalActionsRow, { paddingBottom: 12 + insets.bottom }]}>
              <Pressable style={styles.modalAction} onPress={() => setExpandedMediaUri(null)}>
                <Text style={styles.modalActionText}>Close</Text>
              </Pressable>
              <Pressable
                style={styles.modalActionPrimary}
                onPress={() => downloadMedia(expandedMediaUri)}
                disabled={downloadingMediaUri === expandedMediaUri}
              >
                {downloadingMediaUri === expandedMediaUri ? (
                  <ActivityIndicator color="#0d0d0d" />
                ) : (
                  <Text style={styles.modalActionPrimaryText}>Save</Text>
                )}
              </Pressable>
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

const createStyles = (colors: AppThemeColors, mediaHeight: number) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
    container: { flex: 1, backgroundColor: colors.background },
  feedViewport: {
    flex: 1,
    overflow: "hidden",
  },
  topBar: {
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  topBarOverlay: {
    backgroundColor: "transparent",
    borderBottomWidth: 0,
  },
  brand: { color: colors.text, fontWeight: "700", fontSize: 18 },
  brandSpacer: { width: 60 },
  avatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  topBarActionSlot: {
    width: 48,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  topBarActionPlaceholder: {
    width: 40,
    height: 40,
  },
  topBarDeleteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
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
  mainTab: { color: colors.textSubtle, fontWeight: "700", fontSize: 16 },
  mainTabActive: { color: "#ff6b35" },
  subTabs: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    justifyContent: "center",
  },
  tabsOverlay: {
    backgroundColor: "transparent",
    borderBottomWidth: 0,
  },
  tabOverlayText: {
    color: colors.text,
    textShadowColor: colors.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    fontWeight: "600",
  },
  tab: { color: colors.textSubtle, fontWeight: "600" },
  tabActive: { color: "#ff6b35" },
  card: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 16 },
  row: { flexDirection: "row", gap: 12, flex: 1 },
  avatarWrap: { width: 42, height: 42 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  name: { color: colors.text, fontWeight: "700" },
  handle: { color: colors.textMuted, fontWeight: "400" },
  body: { color: colors.text, marginTop: 4, lineHeight: 20 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tagChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { color: "#ff6b35", fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 18, marginTop: 10, alignItems: "center" },
  actionItem: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  actionText: { color: colors.textMuted, fontSize: 13 },
  reactionActiveLove: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  reactionActiveDislike: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
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
  separator: { height: 1, backgroundColor: colors.border },
  mediaWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mediaFrame: {
    height: mediaHeight,
    width: "100%",
  },
  mediaFill: {
    width: "100%",
    height: "100%",
  },
  media: { width: "100%", alignSelf: "center" },
  mediaDownload: {
    position: "absolute",
    right: 8,
    top: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    borderRadius: 999,
  },
  mediaDownloadBusy: {
    backgroundColor: "rgba(0,0,0,0.78)",
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
  voteBtnText: { color: colors.text, fontWeight: "700" },
  muted: { color: colors.textMuted, marginTop: 8 },
  errorToast: {
    position: "absolute",
    top: "45%",
    left: 24,
    right: 24,
    backgroundColor: colors.overlayStrong,
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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  repostHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  repostAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  repostAuthor: { color: colors.text, fontWeight: "700" },
  repostBody: { color: colors.textMuted, marginTop: 4 },
  banterCard: {
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
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
    borderColor: colors.background,
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
    zIndex: 12,
    elevation: 12,
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
    banterAction: {
      alignItems: "center",
      gap: 3,
      minWidth: 52,
      paddingVertical: 6,
      paddingHorizontal: 6,
      borderRadius: 14,
    },
    banterActionBusy: { opacity: 0.92 },
    banterActionText: { color: colors.text, fontSize: 12 },
  banterReactionActiveLove: {
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.42)",
  },
  banterReactionActiveDislike: {
    backgroundColor: "rgba(239,68,68,0.18)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.42)",
  },
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
    backgroundColor: colors.overlayStrong,
  },
  adCard: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  adHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  adBadge: {
    backgroundColor: "rgba(255,107,53,0.18)",
    borderColor: "rgba(255,107,53,0.5)",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  adTitle: { color: colors.text, fontWeight: "700", fontSize: 15, flex: 1 },
  adBody: { color: colors.textMuted, lineHeight: 18 },
  adCtaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  adCtaText: { color: "#ff6b35", fontWeight: "700" },
  adBanterOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: "rgba(15,23,42,0.6)",
  },
  adBadgeBanter: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,107,53,0.2)",
    borderColor: "rgba(255,107,53,0.5)",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  adBanterTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  adBanterBody: { color: "rgba(255,255,255,0.82)", marginTop: 6, lineHeight: 18 },
  adBanterCta: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#ff6b35",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  adBanterCtaText: { color: "#0d0d0d", fontWeight: "700" },
  repostSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "25%",
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 16,
    borderColor: colors.border,
    borderWidth: 1,
  },
  repostTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  repostInput: {
    marginTop: 12,
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: colors.input,
    color: colors.text,
    padding: 12,
  },
  repostActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  repostBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  repostBtnText: { color: colors.text, fontWeight: "700" },
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
    backgroundColor: colors.overlay,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.86)",
  },
  modalContent: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 96,
  },
  modalImage: { width: "100%", height: "100%" },
  modalActionsRow: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: "row",
    gap: 12,
  },
  modalAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 48,
  },
  modalActionText: { color: colors.text, fontWeight: "700" },
  modalActionPrimary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#ff6b35",
    minHeight: 48,
  },
  modalActionPrimaryText: { color: "#0d0d0d", fontWeight: "700" },
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
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderColor: colors.border,
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
  commentCountText: { color: colors.textMuted, fontSize: 12 },
  commentTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  commentLoading: { paddingVertical: 16, alignItems: "center" },
  commentRow: {
    position: "relative",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  commentName: { color: colors.text, fontWeight: "700" },
  commentText: { color: colors.textSoft, marginTop: 2 },
  commentMetaRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
    alignItems: "center",
  },
  commentMetaText: { color: colors.textMuted, fontSize: 12 },
  commentReplyBtn: { paddingVertical: 2 },
  commentReplyText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  commentRepliesToggle: {
    marginTop: 6,
  },
  commentRepliesText: { color: "#ff6b35", fontSize: 12, fontWeight: "600" },
  commentRepliesWrap: {
    marginTop: 8,
    paddingLeft: 8,
    borderLeftColor: colors.border,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#ff6b35",
  },
  replyName: { color: colors.text, fontWeight: "600", fontSize: 12 },
  replyText: { color: colors.textSoft, marginTop: 2, fontSize: 12 },
  commentComposer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: colors.text,
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
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderColor: colors.border,
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
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  commentReactionEmojiText: { color: colors.text, fontSize: 14 },
  commentReactionBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  commentReactionBadgeText: { color: colors.text, fontSize: 12 },
  commentActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  commentDeleteBtn: {
    backgroundColor: "#3f1d1d",
  },
  commentActionText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  commentActionInline: {
    flexDirection: "row",
    gap: 6,
    marginLeft: 8,
  },
  commentCancel: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  commentCancelText: { color: colors.textMuted, fontSize: 12 },
});
