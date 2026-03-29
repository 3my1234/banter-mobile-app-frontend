import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  ToastAndroid,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Image as RNImage } from "react-native";
import { Video, ResizeMode } from "expo-av";
import { Text } from "@/components/Themed";
import { apiFetch, getCurrentUser } from "@/lib/api";
import { formatRelativeTime } from "@/lib/time";
import VoteGauge from "@/components/VoteGauge";
import ImageCarousel from "@/components/ImageCarousel";
import {
  normalizeMediaUrl,
  resolvePlayableMediaUrl,
  saveMediaToLibrary,
} from "@/lib/media";
import { getSocket } from "@/lib/socket";
import { AppThemeColors, useAppThemeColors } from "@/components/theme";

const ROAST_PREFIX = "[ROAST]";

const showToast = (message: string) => {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("Notice", message);
  }
};

const detectMediaType = (uri?: string | null) => {
  if (!uri) return undefined;
  const lower = uri.toLowerCase();
  if (lower.match(/\.(mp4|mov|m4v|webm|m3u8)$/)) return "video";
  return "image";
};

const normalizeMediaType = (value?: string | null) => {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes("video")) return "video";
  if (lower.includes("image")) return "image";
  return undefined;
};

type MediaItem = {
  type: "image" | "video";
  uri: string;
};

const buildMediaItems = (
  rawMediaItems: unknown,
  fallbackUrl?: string | null,
  fallbackType?: string | null
): MediaItem[] => {
  const normalized = Array.isArray(rawMediaItems)
    ? rawMediaItems
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const normalizedUrl = normalizeMediaUrl((item as any).url);
          const type =
            normalizeMediaType((item as any).type) || detectMediaType(normalizedUrl);
          const uri = type === "video" ? resolvePlayableMediaUrl(normalizedUrl) : normalizedUrl;
          if (!uri || !type) return null;
          return { uri, type: type as "image" | "video" };
        })
        .filter((item): item is MediaItem => !!item)
    : [];

  if (normalized.length) return normalized;

  const normalizedUrl = normalizeMediaUrl(fallbackUrl);
  const type = normalizeMediaType(fallbackType) || detectMediaType(normalizedUrl);
  const uri = type === "video" ? resolvePlayableMediaUrl(normalizedUrl) : normalizedUrl;
  if (!uri || !type) return [];
  return [{ uri, type: type as "image" | "video" }];
};

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

type Post = {
  id: string;
  content: string;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  mediaItems?: Array<{ url: string; type: "image" | "video" }> | null;
  isRoast?: boolean;
  tags?: string[];
  league?: string | null;
  stayVotes: number;
  dropVotes: number;
  commentCount?: number;
  reactionCount?: number;
  shareCount?: number;
  reactionBreakdown?: Record<string, number>;
  userReaction?: string | null;
  repostCount?: number;
  repostOf?: RepostOf | null;
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
  postId?: string;
  userId?: string;
  parentId?: string | null;
  content: string;
  createdAt: string;
  replyCount?: number;
  replies?: Comment[];
  user?: {
    id: string;
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
};

const stripRoastPrefix = (content: string) =>
  content.replace(/^\[ROAST\]\s*/i, "");

const sortCommentsAsc = <T extends { createdAt?: string | null }>(items: T[]) =>
  [...items].sort((a, b) => {
    const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return left - right;
  });

const mergeCommentsById = <T extends { id: string; createdAt?: string | null }>(
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
  return sortCommentsAsc(next);
};

const attachReply = (comments: Comment[], parentId: string, reply: Comment) =>
  comments.map((comment) =>
    comment.id !== parentId
      ? comment
      : {
          ...comment,
          replyCount: Math.max(comment.replyCount ?? 0, (comment.replies?.length ?? 0) + 1),
          replies: mergeCommentsById(comment.replies || [], reply),
        }
  );

const updateCommentTree = (comments: Comment[], updated: Comment) =>
  comments.map((comment) => {
    if (comment.id === updated.id) {
      return { ...comment, ...updated };
    }
    if (comment.replies?.some((reply) => reply.id === updated.id)) {
      return {
        ...comment,
        replies: mergeCommentsById(comment.replies || [], updated),
      };
    }
    return comment;
  });

const removeCommentTree = (comments: Comment[], targetId: string) => {
  const topLevelRemoved = comments.some((comment) => comment.id === targetId);
  if (topLevelRemoved) {
    return comments.filter((comment) => comment.id !== targetId);
  }

  return comments.map((comment) => {
    const existingReplies = comment.replies || [];
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

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const themeColors = useAppThemeColors();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedMediaUri, setSelectedMediaUri] = useState<string | null>(null);
  const [savingMedia, setSavingMedia] = useState(false);
  const [detailAspect, setDetailAspect] = useState<number | null>(null);
  const [showRepostModal, setShowRepostModal] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const detailVideoRefs = React.useRef<Map<string, Video>>(new Map());

  const [meId, setMeId] = useState<string | null>(null);
  const [showPostActions, setShowPostActions] = useState(false);
  const [showEditPost, setShowEditPost] = useState(false);
  const [editPostText, setEditPostText] = useState("");
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [showCommentActions, setShowCommentActions] = useState(false);
  const [showEditComment, setShowEditComment] = useState(false);
  const [editCommentText, setEditCommentText] = useState("");
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesByComment, setRepliesByComment] = useState<Record<string, Comment[]>>({});

  const pauseDetailVideos = React.useCallback(() => {
    detailVideoRefs.current.forEach((ref) => {
      ref.pauseAsync().catch(() => {});
    });
  }, []);
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
      const data = await apiFetch(`/comments/${id}?page=1&limit=50&includeReplies=1`);
      const nextComments = sortCommentsAsc<Comment>(((data.comments || []) as Comment[]));
      setComments(nextComments);
      setRepliesByComment(
        nextComments.reduce<Record<string, Comment[]>>((acc, comment) => {
          if (Array.isArray(comment?.replies) && comment.replies.length) {
            acc[comment.id] = sortCommentsAsc<Comment>(comment.replies);
          }
          return acc;
        }, {})
      );
    } catch {
      setComments([]);
      setRepliesByComment({});
    }
  }, [id]);

  const loadReplies = useCallback(async (commentId: string) => {
    try {
      const data = await apiFetch(`/comments/replies/${commentId}?page=1&limit=20`);
      setRepliesByComment((prev) => ({
        ...prev,
        [commentId]: sortCommentsAsc<Comment>(((data.replies || []) as Comment[])),
      }));
    } catch {
      setRepliesByComment((prev) => ({ ...prev, [commentId]: [] }));
    }
  }, []);

  useEffect(() => {
    loadPost();
    loadComments();
  }, [loadPost, loadComments]);


  const loadMe = useCallback(async () => {
    try {
      const data = await getCurrentUser();
      const user = data.user || data;
      setMeId(user?.id || null);
    } catch {
      setMeId(null);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);
  const handleVote = async (voteType: "STAY" | "DROP") => {
    if (!post) return;
    try {
      const data = await apiFetch("/votes", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, voteType }),
      });
      const next = data?.post;
      if (next?.id) {
        setPost({
          ...post,
          stayVotes: next.stayVotes,
          dropVotes: next.dropVotes,
        });
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleReaction = async (type: "LOVE" | "ANGRY") => {
    if (!post) return;
    try {
      const currentReaction = post.userReaction ?? null;
      const nextReaction = currentReaction === type ? null : type;
      const breakdown = { ...(post.reactionBreakdown || {}) } as Record<
        string,
        number
      >;
      let reactionCount = post.reactionCount || 0;

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

      setPost((prev) =>
        prev
          ? {
              ...prev,
              reactionCount,
              reactionBreakdown: breakdown,
              userReaction: nextReaction,
            }
          : prev
      );
      const data = await apiFetch("/reactions", {
        method: "POST",
        body: JSON.stringify({ postId: post.id, type }),
      });
      if (typeof data?.reactionCount === "number") {
        setPost((prev) =>
          prev ? { ...prev, reactionCount: data.reactionCount } : prev
        );
      }
      if (data?.reactionBreakdown) {
        setPost((prev) =>
          prev ? { ...prev, reactionBreakdown: data.reactionBreakdown } : prev
        );
      }
      if (data?.reaction || data?.reaction === null) {
        setPost((prev) =>
          prev
            ? {
                ...prev,
                userReaction: data.reaction ? data.reaction.type : null,
              }
            : prev
        );
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRepost = async (comment?: string) => {
    if (!post) return;
    try {
      const data = await apiFetch(`/posts/${post.id}/repost`, {
        method: "POST",
        body: JSON.stringify({ comment: comment || "" }),
      });
      if (typeof data?.repostCount === "number") {
        setPost((prev) =>
          prev ? { ...prev, repostCount: data.repostCount } : prev
        );
      }
      await loadPost();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const openRepostModal = () => {
    setQuoteText("");
    setShowRepostModal(true);
  };

  const handleSubmitComment = async () => {
    if (!post || !commentText.trim()) return;
    setSubmitting(true);
    try {
      const data = await apiFetch("/comments", {
        method: "POST",
        body: JSON.stringify({
          postId: post.id,
          content: commentText.trim(),
          parentId: replyTarget?.id ?? null,
        }),
      });
      const created = data.comment || data;
      if (replyTarget?.id) {
        setComments((prev) => attachReply(prev, replyTarget.id!, created));
        setRepliesByComment((prev) => ({
          ...prev,
          [replyTarget.id!]: mergeCommentsById(prev[replyTarget.id!] || [], created),
        }));
        setExpandedReplies((prev) => ({ ...prev, [replyTarget.id!]: true }));
      } else {
        setComments((prev) => mergeCommentsById(prev, created));
      }
      if (typeof data?.commentCount === "number") {
        setPost((prev) =>
          prev ? { ...prev, commentCount: data.commentCount } : prev
        );
      }
      setCommentText("");
      setReplyTarget(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };
  const handleEditPost = async () => {
    if (!post) return;
    const nextContent = editPostText.trim();
    if (!nextContent) return;
    try {
      const data = await apiFetch(`/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: nextContent }),
      });
      if (data?.post) {
        setPost(data.post);
        setEditPostText("");
        setShowEditPost(false);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeletePost = async () => {
    if (!post) return;
    try {
      await apiFetch(`/posts/${post.id}`, { method: "DELETE" });
      router.back();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEditComment = async () => {
    if (!selectedComment) return;
    const nextContent = editCommentText.trim();
    if (!nextContent) return;
    try {
      const data = await apiFetch(`/comments/${selectedComment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: nextContent }),
      });
      const updated = data?.comment;
      if (updated?.id) {
        setComments((prev) =>
          prev.map((c) => (c.id === updated.id ? { ...c, content: updated.content } : c))
        );
        setShowEditComment(false);
        setSelectedComment(null);
        setEditCommentText("");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeleteComment = async (comment: Comment) => {
    try {
      const data = await apiFetch(`/comments/${comment.id}`, { method: "DELETE" });
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      if (typeof data?.commentCount === "number") {
        setPost((prev) => (prev ? { ...prev, commentCount: data.commentCount } : prev));
      }
      setShowCommentActions(false);
      setSelectedComment(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const mediaItems = buildMediaItems(post?.mediaItems, post?.mediaUrl, post?.mediaType);
  const mediaUrl = mediaItems[0]?.uri;
  const avatarUrl = normalizeMediaUrl(post?.user?.avatarUrl);
  const repostAvatarUrl = normalizeMediaUrl(post?.repostOf?.user?.avatarUrl);
  const displayName = post?.user?.displayName || post?.user?.username || "Banter";
  const handle = post?.user?.username ? `@${post.user.username}` : "@banter";
  const createdAt = post?.createdAt ? formatRelativeTime(post.createdAt) : "";
  const isRoast = !!post?.isRoast || (post?.content || "").startsWith(ROAST_PREFIX);
  const mediaType =
    mediaItems[0]?.type ||
    normalizeMediaType(post?.mediaType) ||
    detectMediaType(mediaUrl);

  useEffect(() => {
    if (!mediaUrl || mediaItems.length > 1) {
      setDetailAspect(null);
      return;
    }
    if (mediaType === "video") {
      setDetailAspect(16 / 9);
      return;
    }
    RNImage.getSize(
      mediaUrl,
      (width, height) => {
        if (width && height) {
          const aspect = width / height;
          setDetailAspect(aspect);
        }
      },
      () => setDetailAspect(16 / 9)
    );
  }, [mediaItems.length, mediaUrl, mediaType]);

  useEffect(() => {
    let active = true;
    let socket: any;

    const setup = async () => {
      if (!id) return;
      socket = await getSocket();
      if (!active) return;

      socket.emit("join-post", id);

      const onVoteUpdate = (payload: any) => {
        const { postId, stayVotes, dropVotes } = payload || {};
        if (!postId) return;
        setPost((prev) =>
          prev && prev.id === postId ? { ...prev, stayVotes, dropVotes } : prev
        );
      };

      const onPostHidden = (payload: any) => {
        const { postId } = payload || {};
        if (!postId) return;
        setPost((prev) => (prev && prev.id === postId ? prev : prev));
        if (postId === id) {
          setError("This post has been hidden.");
        }
      };

      const onCommentCreated = (payload: any) => {
        const { postId, comment, commentCount } = payload || {};
        if (!postId || postId !== id || !comment?.id) return;
        if (comment.parentId) {
          setComments((prev) => attachReply(prev, comment.parentId, comment));
          setRepliesByComment((prev) => ({
            ...prev,
            [comment.parentId]: mergeCommentsById(prev[comment.parentId] || [], comment),
          }));
        } else {
          setComments((prev) => mergeCommentsById(prev, comment));
        }
        if (typeof commentCount === "number") {
          setPost((prev) =>
            prev ? { ...prev, commentCount } : prev
          );
        }
      };

      const onCommentUpdated = (payload: any) => {
        const { postId, comment } = payload || {};
        if (!postId || postId !== id || !comment?.id) return;
        setComments((prev) => updateCommentTree(prev, comment));
        if (comment.parentId) {
          setRepliesByComment((prev) => ({
            ...prev,
            [comment.parentId]: mergeCommentsById(prev[comment.parentId] || [], comment),
          }));
        }
      };

      const onCommentDeleted = (payload: any) => {
        const { postId, commentId, commentCount } = payload || {};
        if (!postId || postId !== id || !commentId) return;
        setComments((prev) => removeCommentTree(prev, commentId));
        setRepliesByComment((prev) => {
          const next = { ...prev };
          delete next[commentId];
          Object.keys(next).forEach((parentId) => {
            next[parentId] = next[parentId].filter((reply) => reply.id !== commentId);
          });
          return next;
        });
        if (typeof commentCount === "number") {
          setPost((prev) => (prev ? { ...prev, commentCount } : prev));
        }
      };

      const onReactionUpdate = (payload: any) => {
        const { postId, reactionCount, reactionBreakdown } = payload || {};
        if (!postId || postId !== id) return;
        if (typeof reactionCount === "number") {
          setPost((prev) =>
            prev ? { ...prev, reactionCount } : prev
          );
        }
        if (reactionBreakdown) {
          setPost((prev) =>
            prev ? { ...prev, reactionBreakdown } : prev
          );
        }
      };

      const onShareUpdate = (payload: any) => {
        const { postId, shareCount } = payload || {};
        if (!postId || postId !== id) return;
        if (typeof shareCount === "number") {
          setPost((prev) =>
            prev ? { ...prev, shareCount } : prev
          );
        }
      };

      const onRepostUpdate = (payload: any) => {
        const { postId, repostCount } = payload || {};
        if (!postId || postId !== id) return;
        if (typeof repostCount === "number") {
          setPost((prev) =>
            prev ? { ...prev, repostCount } : prev
          );
        }
      };

      socket.on("vote-update", onVoteUpdate);
      socket.on("post-hidden", onPostHidden);
      socket.on("comment-created", onCommentCreated);
socket.on("comment-updated", onCommentUpdated);
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
        if (id) socket.emit("leave-post", id);
        socket.off("vote-update");
        socket.off("post-hidden");
        socket.off("comment-created");
socket.off("comment-updated");
socket.off("comment-deleted");
        socket.off("reaction-update");
        socket.off("share-update");
        socket.off("repost-update");
        socket.off("post-stays");
      }
    };
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        pauseDetailVideos();
      };
    }, [pauseDetailVideos])
  );

  const header = useMemo(() => {
    if (!post) return null;
    const isRepost = !!post.repostOf;
    const original = post.repostOf;
    const originalMediaItems = buildMediaItems(
      original?.mediaItems,
      original?.mediaUrl,
      original?.mediaType || null
    );
    const originalMediaUrl = originalMediaItems[0]?.uri;
    const originalMediaType = originalMediaItems[0]?.type;
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
            {isRepost ? (
              <Text style={styles.repostLabel}>
                {original?.isRoast ? "Rebantered" : "Reposted"} by {handle}
              </Text>
            ) : null}
            <Text style={styles.name}>
              {displayName} <Text style={styles.handle}>{handle} · {createdAt}</Text>
            </Text>
            {post.content?.trim() ? (
              <Text style={styles.body}>{stripRoastPrefix(post.content || "")}</Text>
            ) : null}
            {mediaItems.length ? (
              mediaItems.length > 1 ? (
                <View style={styles.mediaWrapper}>
                  <ImageCarousel
                    items={mediaItems.map((item) => ({ uri: item.uri }))}
                    aspectRatio={detailAspect || 16 / 9}
                    onPressItem={(uri) => setSelectedMediaUri(uri)}
                    onDownload={(uri) => saveMedia(uri)}
                  />
                </View>
              ) : mediaType === "video" ? (
	                  <View style={styles.mediaWrapper}>
	                  <Video
	                    source={{ uri: mediaUrl }}
	                    style={[styles.media, { aspectRatio: detailAspect || 16 / 9 }]}
	                    resizeMode={ResizeMode.COVER}
	                    useNativeControls
                      ref={(ref) => {
                        const key = `post:${post.id}`;
                        if (ref) {
                          detailVideoRefs.current.set(key, ref);
                        } else {
                          detailVideoRefs.current.delete(key);
                        }
                      }}
	                  />
                </View>
              ) : (
                <Pressable
                  style={styles.mediaWrapper}
                  onPress={() => setSelectedMediaUri(mediaUrl)}
                >
                  <ExpoImage
                    source={{ uri: mediaUrl }}
                    style={[styles.media, { aspectRatio: detailAspect || 16 / 9 }]}
                    contentFit="cover"
                    contentPosition="center"
                    transition={180}
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              )
            ) : null}
            {isRepost && original ? (
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
                    {original.user?.displayName ||
                      original.user?.username ||
                      "Banter"}{" "}
                    <Text style={styles.handle}>
                      {original.user?.username
                        ? `@${original.user.username}`
                        : "@banter"}
                    </Text>
                  </Text>
                </View>
                <Text style={styles.repostBody}>
                  {stripRoastPrefix(original.content || "")}
                </Text>
                {originalMediaItems.length ? (
	                  <View style={styles.mediaWrapper}>
	                    {originalMediaItems.length > 1 ? (
                        <ImageCarousel
                          items={originalMediaItems.map((item) => ({ uri: item.uri }))}
                          aspectRatio={16 / 9}
                          onPressItem={(uri) => setSelectedMediaUri(uri)}
                          onDownload={(uri) => saveMedia(uri)}
                        />
                      ) : originalMediaType === "video" ? (
		                      <Video
		                        source={{ uri: originalMediaUrl }}
		                        style={[styles.media, { aspectRatio: 16 / 9 }]}
		                        resizeMode={ResizeMode.COVER}
		                        useNativeControls
                            ref={(ref) => {
                              const key = `repost:${original.id}`;
                              if (ref) {
                                detailVideoRefs.current.set(key, ref);
                              } else {
                                detailVideoRefs.current.delete(key);
                              }
                            }}
		                      />
	                    ) : (
                      <Pressable onPress={() => setSelectedMediaUri(originalMediaUrl || null)}>
                        <ExpoImage
                          source={{ uri: originalMediaUrl }}
                          style={[styles.media, { aspectRatio: 16 / 9 }]}
                          contentFit="cover"
                          contentPosition="center"
                          transition={180}
                          cachePolicy="memory-disk"
                        />
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
            {isRoast && (
              <View style={{ marginTop: 10 }}>
                <VoteGauge stayVotes={post.stayVotes} dropVotes={post.dropVotes} />
                <View style={styles.voteActions}>
                  <Pressable style={styles.stayBtn} onPress={() => handleVote("STAY")}>
                    <Text style={styles.voteBtnText}>Stay</Text>
                  </Pressable>
                  <Pressable style={styles.dropBtn} onPress={() => handleVote("DROP")}>
                    <Text style={styles.voteBtnText}>Drop</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <FontAwesome name="comment-o" size={16} color="#9ca3af" />
                <Text style={styles.metaText}>{post.commentCount ?? comments.length}</Text>
              </View>
              <Pressable style={styles.metaItem} onPress={openRepostModal}>
                <FontAwesome name="retweet" size={16} color="#9ca3af" />
                <Text style={styles.metaText}>{post.repostCount ?? 0}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.metaItem,
                  post.userReaction === "LOVE" && styles.metaReactionLoveActive,
                ]}
                onPress={() => handleReaction("LOVE")}
              >
                <FontAwesome
                  name={post.userReaction === "LOVE" ? "heart" : "heart-o"}
                  size={16}
                  color={post.userReaction === "LOVE" ? "#f59e0b" : "#9ca3af"}
                />
                <Text
                  style={[
                    styles.metaText,
                    post.userReaction === "LOVE" ? { color: "#f59e0b" } : null,
                  ]}
                >
                  {post.reactionBreakdown?.LOVE ?? 0}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.metaItem,
                  post.userReaction === "ANGRY" && styles.metaReactionDislikeActive,
                ]}
                onPress={() => handleReaction("ANGRY")}
              >
                <FontAwesome
                  name={post.userReaction === "ANGRY" ? "thumbs-down" : "thumbs-o-down"}
                  size={16}
                  color={post.userReaction === "ANGRY" ? "#ef4444" : "#9ca3af"}
                />
                <Text
                  style={[
                    styles.metaText,
                    post.userReaction === "ANGRY" ? { color: "#ef4444" } : null,
                  ]}
                >
                  {post.reactionBreakdown?.ANGRY ?? 0}
                </Text>
              </Pressable>
              <Pressable
                style={styles.metaItem}
                onPress={async () => {
                  try {
                    await Share.share({
                      message:
                        stripRoastPrefix(post.content || "") ||
                        stripRoastPrefix(post.repostOf?.content || "") ||
                        "Banter post",
                    });
                  } finally {
                    try {
                      const data = await apiFetch(`/posts/${post.id}/share`, {
                        method: "POST",
                      });
                      if (typeof data?.shareCount === "number") {
                        setPost((prev) =>
                          prev ? { ...prev, shareCount: data.shareCount } : prev
                        );
                      }
                    } catch {
                      // ignore
                    }
                  }
                }}
              >
                <FontAwesome name="share-alt" size={16} color="#9ca3af" />
                <Text style={styles.metaText}>{post.shareCount ?? 0}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }, [
    post,
    avatarUrl,
    repostAvatarUrl,
    displayName,
    handle,
    createdAt,
    isRoast,
    mediaItems,
    mediaUrl,
    mediaType,
    detailAspect,
    comments.length,
  ]);

  const saveMedia = async (uri?: string | null) => {
    const targetUri = uri || selectedMediaUri || mediaUrl;
    if (!targetUri) return;
    setSavingMedia(true);
    showToast("Downloading...");
    try {
      await saveMediaToLibrary(targetUri);
      showToast("Saved to gallery.");
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
        <Pressable onPress={() => router.back()} hitSlop={16}>
          <FontAwesome name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={styles.headerSpacer} />
        {post?.user?.id && post.user.id === meId ? (
          <Pressable
            onPress={() => {
              setEditPostText(stripRoastPrefix(post?.content || ""));
              setShowPostActions(true);
            }}
          >
            <FontAwesome name="ellipsis-h" size={18} color="#fff" />
          </Pressable>
        ) : (
          <View style={{ width: 18 }} />
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 64 : 0}
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
                <View style={styles.commentMetaRow}>
                  <Text style={styles.commentMetaText}>
                    {formatRelativeTime(item.createdAt)}
                  </Text>
                  <Pressable
                    style={styles.commentReplyBtn}
                    onPress={() => setReplyTarget(item)}
                  >
                    <Text style={styles.commentReplyText}>Reply</Text>
                  </Pressable>
                </View>
                {item.replyCount ? (
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
                (repliesByComment[item.id] || item.replies)?.length ? (
                  <View style={styles.commentRepliesWrap}>
                    {(repliesByComment[item.id] || item.replies || []).map((reply) => (
                      <View key={reply.id} style={styles.replyRow}>
                        {reply.user?.avatarUrl ? (
                          <ExpoImage
                            source={{ uri: normalizeMediaUrl(reply.user.avatarUrl) }}
                            style={styles.replyAvatar}
                            contentFit="cover"
                            transition={180}
                            cachePolicy="memory-disk"
                          />
                        ) : (
                          <View style={styles.replyAvatar} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.replyName}>
                            {reply.user?.displayName || reply.user?.username || "User"}
                          </Text>
                          <Text style={styles.replyText}>{reply.content}</Text>
                          <Text style={styles.commentMetaText}>
                            {formatRelativeTime(reply.createdAt)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
              {item.user?.id && item.user.id === meId ? (
                <Pressable
                  style={styles.commentMenu}
                  onPress={() => {
                    setSelectedComment(item);
                    setEditCommentText(item.content);
                    setShowCommentActions(true);
                  }}
                >
                  <FontAwesome name="ellipsis-h" size={14} color="#9ca3af" />
                </Pressable>
              ) : null}
            </View>
          )}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadPost();
            loadComments();
          }}
          contentContainerStyle={{
            paddingBottom: 140 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        />

        <View
          style={[
            styles.commentComposer,
            { paddingBottom: 8 + insets.bottom },
          ]}
        >
          <TextInput
            style={styles.commentInput}
            placeholder={
              replyTarget
                ? `Reply to @${
                    replyTarget.user?.username ||
                    replyTarget.user?.displayName ||
                    "user"
                  }...`
                : "Write a comment..."
            }
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
        {replyTarget ? (
          <Pressable style={styles.commentCancel} onPress={() => setReplyTarget(null)}>
            <Text style={styles.commentCancelText}>Cancel reply</Text>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>

      {selectedMediaUri ? (
        <Modal transparent visible animationType="fade">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalMediaWrap}>
              <RNImage
                source={{ uri: selectedMediaUri }}
                style={styles.modalMediaImage}
                resizeMode="contain"
              />
            </View>
          </View>
          <View style={[styles.modalActions, { paddingBottom: 12 + insets.bottom }]}>
            <Pressable style={styles.modalBtn} onPress={() => setSelectedMediaUri(null)}>
              <Text style={styles.modalBtnText}>Close</Text>
            </Pressable>
            <Pressable
              style={styles.modalBtnPrimary}
              onPress={() => saveMedia(selectedMediaUri)}
              disabled={savingMedia}
            >
              {savingMedia ? (
                <ActivityIndicator color="#0d0d0d" />
              ) : (
                <Text style={styles.modalBtnPrimaryText}>Save</Text>
              )}
            </Pressable>
          </View>
        </Modal>
      ) : null}

      {showRepostModal ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            style={styles.repostBackdrop}
            onPress={() => setShowRepostModal(false)}
          />
          <View style={styles.repostSheet}>
            <Text style={styles.repostTitle}>
              {post?.repostOf?.isRoast || post?.isRoast ? "Rebanter" : "Repost"}
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
                  handleRepost();
                }}
              >
                <Text style={styles.repostBtnText}>
                  {post?.repostOf?.isRoast || post?.isRoast ? "Rebanter" : "Repost"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.repostBtnPrimary}
                onPress={() => {
                  setShowRepostModal(false);
                  handleRepost(quoteText.trim());
                }}
              >
                <Text style={styles.repostBtnPrimaryText}>Quote</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {showPostActions ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            style={styles.actionBackdrop}
            onPress={() => setShowPostActions(false)}
          />
          <View style={styles.actionSheet}>
            <Pressable
              style={styles.actionItem}
              onPress={() => {
                setShowPostActions(false);
                setShowEditPost(true);
              }}
            >
              <Text style={styles.actionText}>Edit Post</Text>
            </Pressable>
            <Pressable
              style={styles.actionItem}
              onPress={() => {
                setShowPostActions(false);
                Alert.alert("Delete post?", "This cannot be undone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: handleDeletePost },
                ]);
              }}
            >
              <Text style={styles.actionDelete}>Delete Post</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}

      {showEditPost ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            style={styles.actionBackdrop}
            onPress={() => setShowEditPost(false)}
          />
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>Edit Post</Text>
            <TextInput
              style={styles.editInput}
              value={editPostText}
              onChangeText={setEditPostText}
              placeholder="Update your post"
              placeholderTextColor="#777"
              multiline
            />
            <View style={styles.editActions}>
              <Pressable
                style={styles.editBtn}
                onPress={() => setShowEditPost(false)}
              >
                <Text style={styles.editBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.editBtnPrimary}
                onPress={handleEditPost}
              >
                <Text style={styles.editBtnPrimaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

      {showCommentActions && selectedComment ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            style={styles.actionBackdrop}
            onPress={() => setShowCommentActions(false)}
          />
          <View style={styles.actionSheet}>
            <Pressable
              style={styles.actionItem}
              onPress={() => {
                setShowCommentActions(false);
                setShowEditComment(true);
              }}
            >
              <Text style={styles.actionText}>Edit Comment</Text>
            </Pressable>
            <Pressable
              style={styles.actionItem}
              onPress={() => {
                setShowCommentActions(false);
                Alert.alert("Delete comment?", "This cannot be undone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => handleDeleteComment(selectedComment) },
                ]);
              }}
            >
              <Text style={styles.actionDelete}>Delete Comment</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}

      {showEditComment ? (
        <Modal transparent animationType="fade" visible>
          <Pressable
            style={styles.actionBackdrop}
            onPress={() => setShowEditComment(false)}
          />
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>Edit Comment</Text>
            <TextInput
              style={styles.editInput}
              value={editCommentText}
              onChangeText={setEditCommentText}
              placeholder="Update your comment"
              placeholderTextColor="#777"
              multiline
            />
            <View style={styles.editActions}>
              <Pressable
                style={styles.editBtn}
                onPress={() => setShowEditComment(false)}
              >
                <Text style={styles.editBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.editBtnPrimary}
                onPress={handleEditComment}
              >
                <Text style={styles.editBtnPrimaryText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}

    </SafeAreaView>
  );
}

const createStyles = (colors: AppThemeColors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerSpacer: { width: 18 },
  headerTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  postCard: { padding: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  row: { flexDirection: "row", gap: 12 },
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
  mediaWrapper: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  media: { width: "100%" },
  mediaDownload: {
    position: "absolute",
    right: 8,
    top: 8,
    backgroundColor: colors.overlay,
    padding: 6,
    borderRadius: 999,
  },
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
  voteBtnText: { color: colors.text, fontWeight: "700" },
  metaRow: { flexDirection: "row", gap: 18, marginTop: 10, alignItems: "center" },
  metaItem: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaText: { color: colors.textMuted, fontSize: 12 },
  metaReactionLoveActive: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  metaReactionDislikeActive: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  repostLabel: { color: "#ff6b35", fontWeight: "700", marginBottom: 6 },
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
  repostBody: { color: colors.textSoft, marginTop: 4 },
  commentRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  commentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
  commentRepliesToggle: { marginTop: 6 },
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
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 10,
  },
  commentInput: {
    flex: 1,
    backgroundColor: colors.surface,
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
  commentCancel: {
    position: "absolute",
    right: 16,
    bottom: 62,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  commentCancelText: { color: colors.textMuted, fontSize: 12 },
  muted: { color: colors.textMuted, marginTop: 8 },
  error: { color: "#ff6b35", paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: "stretch",
    justifyContent: "center",
  },
  modalMediaWrap: { flex: 1, alignSelf: "stretch", padding: 16, paddingBottom: 96 },
  modalMediaImage: { width: "100%", height: "100%" },
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
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  modalBtnText: { color: colors.text, fontWeight: "700" },
  modalBtnPrimary: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  modalBtnPrimaryText: { color: "#0d0d0d", fontWeight: "700" },
  repostBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
  },
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

  actionBackdrop: {
    flex: 1,
    backgroundColor: colors.overlayStrong,
  },
  actionSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: "30%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderColor: colors.border,
    borderWidth: 1,
    paddingVertical: 8,
  },
  actionItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  actionText: { color: colors.text, fontWeight: "700" },
  actionDelete: { color: "#f97316", fontWeight: "700" },
  editSheet: {
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
  editTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  editInput: {
    marginTop: 12,
    minHeight: 80,
    borderRadius: 12,
    backgroundColor: colors.input,
    color: colors.text,
    padding: 12,
  },
  editActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  editBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  editBtnText: { color: colors.text, fontWeight: "700" },
  editBtnPrimary: {
    flex: 1,
    backgroundColor: "#ff6b35",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  editBtnPrimaryText: { color: "#0d0d0d", fontWeight: "700" },
  commentMenu: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
