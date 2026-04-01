import { Image as ExpoImage } from "expo-image";
import { apiFetch, getCurrentUser, getSession } from "./api";
import { normalizeMediaUrl, resolvePlayableMediaUrl } from "./media";
import { registerDevicePushToken } from "./pushNotifications";

type FeedType = "posts" | "banter";

type FeedSnapshot = {
  posts: any[];
  pagination?: any;
};

type WalletOverviewSnapshot = {
  balances: Record<string, any> | null;
  wallets: any[];
  transactions: any[];
  pagination?: any;
};

type RolleyStakeSnapshot = {
  userId: string;
  stakes: any[];
};

type CacheEntry<T> = {
  expiresAt: number;
  data: T;
};

const FEED_TTL_MS = 45_000;
const WALLET_TTL_MS = 20_000;
const ROLLEY_STAKE_TTL_MS = 20_000;
const BOOTSTRAP_COOLDOWN_MS = 8_000;
const WALLET_REFRESH_COOLDOWN_MS = 60_000;
const MAX_WARM_IMAGES = 24;
const MAX_WARM_VIDEOS = 8;
const MAX_WARM_POSTS = 120;
const VIDEO_WARM_RANGE_BYTES = 1024 * 1024;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|m3u8)(\?|$)/i;

const ROLLEY_SERVICE_URL =
  process.env.EXPO_PUBLIC_ROLLEY_SERVICE_URL ?? "https://sportbanter.online/rolley";
const ROLLEY_FETCH_TIMEOUT_MS = Number.parseInt(
  process.env.EXPO_PUBLIC_ROLLEY_FETCH_TIMEOUT_MS || "10000",
  10
);

let activeSessionToken: string | null = null;
let walletCache: CacheEntry<WalletOverviewSnapshot> | null = null;
let walletInFlight: Promise<WalletOverviewSnapshot> | null = null;
let walletRefreshInFlight: Promise<WalletOverviewSnapshot | null> | null = null;
let lastWalletRefreshAt = 0;
let rolleyStakeCache: CacheEntry<RolleyStakeSnapshot> | null = null;
let rolleyStakeInFlight: Promise<RolleyStakeSnapshot> | null = null;
let bootstrapInFlight: Promise<void> | null = null;
let lastBootstrapAt = 0;

const feedCache = new Map<string, CacheEntry<FeedSnapshot>>();
const feedInFlight = new Map<string, Promise<FeedSnapshot>>();
const warmPostsById = new Map<string, any>();
const warmedMediaUris = new Set<string>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const buildRolleyUrl = (path: string) => {
  const base = ROLLEY_SERVICE_URL.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (
  input: string,
  init?: RequestInit,
  timeoutMs: number = ROLLEY_FETCH_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const normalizeMediaType = (value?: unknown): "image" | "video" | null => {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  if (lower.includes("video")) return "video";
  if (lower.includes("image")) return "image";
  return null;
};

const detectMediaType = (uri?: string): "image" | "video" | null => {
  if (!uri) return null;
  return VIDEO_EXT_RE.test(uri.toLowerCase()) ? "video" : "image";
};

const resetRuntimeCaches = () => {
  walletCache = null;
  walletInFlight = null;
  walletRefreshInFlight = null;
  lastWalletRefreshAt = 0;
  rolleyStakeCache = null;
  rolleyStakeInFlight = null;
  feedCache.clear();
  feedInFlight.clear();
  warmPostsById.clear();
  warmedMediaUris.clear();
  bootstrapInFlight = null;
  lastBootstrapAt = 0;
};

const triggerBackgroundWalletRefresh = (force = false) => {
  const now = Date.now();
  if (!force && walletRefreshInFlight) return walletRefreshInFlight;
  if (!force && now - lastWalletRefreshAt < WALLET_REFRESH_COOLDOWN_MS) return null;

  walletRefreshInFlight = fetchWalletOverview({
    force: true,
    refresh: true,
    limit: 20,
    page: 1,
  })
    .then(async (snapshot) => {
      // Read back the latest stored snapshot after refresh task has had time to complete.
      await sleep(1200);
      await fetchWalletOverview({
        force: true,
        refresh: false,
        limit: 20,
        page: 1,
      }).catch(() => null);
      lastWalletRefreshAt = Date.now();
      return snapshot;
    })
    .catch(() => null)
    .finally(() => {
      walletRefreshInFlight = null;
    });

  return walletRefreshInFlight;
};

const ensureActiveToken = async () => {
  const nextToken = (await getSession())?.token || null;
  if (nextToken !== activeSessionToken) {
    resetRuntimeCaches();
    activeSessionToken = nextToken;
  }
  return nextToken;
};

const makeFeedCacheKey = (type: FeedType, feed: string) => `${type}:${feed}`;

const trimWarmPostCache = () => {
  const overflow = warmPostsById.size - MAX_WARM_POSTS;
  if (overflow <= 0) return;
  const keys = Array.from(warmPostsById.keys()).slice(0, overflow);
  keys.forEach((key) => warmPostsById.delete(key));
};

const normalizeItemUrl = (url?: unknown) => {
  if (typeof url !== "string" || !url.trim()) return "";
  return resolvePlayableMediaUrl(normalizeMediaUrl(url)) || "";
};

const collectMediaFromPost = (
  post: any,
  imageUris: Set<string>,
  videoUris: Set<string>
) => {
  const includeUrl = (rawUrl?: unknown, rawType?: unknown) => {
    const uri = normalizeItemUrl(rawUrl);
    if (!uri || warmedMediaUris.has(uri)) return;
    const type = normalizeMediaType(rawType) || detectMediaType(uri);
    if (type === "video") {
      videoUris.add(uri);
      return;
    }
    imageUris.add(uri);
  };

  if (!post || typeof post !== "object") return;

  includeUrl(post.user?.avatarUrl, "image");
  includeUrl(post.mediaUrl, post.mediaType);
  if (Array.isArray(post.mediaItems)) {
    post.mediaItems.forEach((item: any) => includeUrl(item?.url, item?.type));
  }

  includeUrl(post.repostOf?.user?.avatarUrl, "image");
  includeUrl(post.repostOf?.mediaUrl, post.repostOf?.mediaType);
  if (Array.isArray(post.repostOf?.mediaItems)) {
    post.repostOf.mediaItems.forEach((item: any) => includeUrl(item?.url, item?.type));
  }
};

const warmMediaForPosts = (posts: any[]) => {
  if (!Array.isArray(posts) || posts.length === 0) return;
  const imageUris = new Set<string>();
  const videoUris = new Set<string>();

  posts.slice(0, 20).forEach((post) => collectMediaFromPost(post, imageUris, videoUris));

  const images = Array.from(imageUris).slice(0, MAX_WARM_IMAGES);
  const videos = Array.from(videoUris).slice(0, MAX_WARM_VIDEOS);

  images.forEach((uri) => warmedMediaUris.add(uri));
  videos.forEach((uri) => warmedMediaUris.add(uri));

  if (images.length > 0) {
    void ExpoImage.prefetch(images).catch(() => undefined);
  }
  videos.forEach((uri) => {
    void fetch(uri, {
      method: "GET",
      headers: { Range: `bytes=0-${VIDEO_WARM_RANGE_BYTES - 1}` },
    })
      .catch(() => fetch(uri, { method: "HEAD" }))
      .catch(() => undefined);
  });
};

const rememberPosts = (posts: any[]) => {
  if (!Array.isArray(posts) || posts.length === 0) return;
  posts.forEach((post) => {
    if (post?.id) {
      warmPostsById.set(String(post.id), clone(post));
    }
  });
  trimWarmPostCache();
};

export function clearBootstrapCache() {
  activeSessionToken = null;
  resetRuntimeCaches();
}

export function rememberWarmPost(post: any) {
  if (!post?.id) return;
  warmPostsById.set(String(post.id), clone(post));
  trimWarmPostCache();
}

export function rememberWarmPosts(posts: any[]) {
  rememberPosts(posts);
}

export function getWarmPostById(postId?: string | null) {
  if (!postId) return null;
  const cached = warmPostsById.get(String(postId));
  return cached ? clone(cached) : null;
}

export function getCachedFeedSnapshot(type: FeedType, feed: string) {
  const cached = feedCache.get(makeFeedCacheKey(type, feed));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return clone(cached.data);
}

export async function fetchFeedSnapshot(
  type: FeedType,
  feed: string,
  options?: { force?: boolean }
) {
  await ensureActiveToken();

  const force = options?.force === true;
  const cacheKey = makeFeedCacheKey(type, feed);
  const cached = feedCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return clone(cached.data);
  }

  if (!force) {
    const inFlight = feedInFlight.get(cacheKey);
    if (inFlight) {
      return clone(await inFlight);
    }
  }

  const requestPromise = (async () => {
    const data = await apiFetch(`/posts?type=${type}&feed=${feed}&page=1&limit=20`);
    const snapshot: FeedSnapshot = {
      posts: Array.isArray(data?.posts) ? data.posts : [],
      pagination: data?.pagination,
    };
    feedCache.set(cacheKey, {
      data: snapshot,
      expiresAt: Date.now() + FEED_TTL_MS,
    });
    rememberPosts(snapshot.posts);
    warmMediaForPosts(snapshot.posts);
    return snapshot;
  })();

  feedInFlight.set(cacheKey, requestPromise);
  try {
    return clone(await requestPromise);
  } catch (error) {
    const fallback = feedCache.get(cacheKey);
    if (fallback) {
      return clone(fallback.data);
    }
    throw error;
  } finally {
    feedInFlight.delete(cacheKey);
  }
}

export function getCachedWalletOverview() {
  if (!walletCache || walletCache.expiresAt <= Date.now()) return null;
  return clone(walletCache.data);
}

export async function fetchWalletOverview(options?: {
  force?: boolean;
  refresh?: boolean;
  limit?: number;
  page?: number;
}) {
  await ensureActiveToken();

  const force = options?.force === true;
  const refresh = options?.refresh === true;
  const limit = options?.limit ?? 20;
  const page = options?.page ?? 1;

  if (!force && !refresh && walletCache && walletCache.expiresAt > Date.now()) {
    return clone(walletCache.data);
  }

  if (!force && !refresh && walletInFlight) {
    return clone(await walletInFlight);
  }

  const path = refresh
    ? `/wallet/overview?limit=${limit}&page=${page}&refresh=1`
    : `/wallet/overview?limit=${limit}&page=${page}`;

  const requestPromise = (async () => {
    const data = await apiFetch(path);
    const snapshot: WalletOverviewSnapshot = {
      balances: data?.balances || null,
      wallets: Array.isArray(data?.wallets) ? data.wallets : [],
      transactions: Array.isArray(data?.transactions) ? data.transactions : [],
      pagination: data?.pagination,
    };
    if (!refresh) {
      walletCache = {
        data: snapshot,
        expiresAt: Date.now() + WALLET_TTL_MS,
      };
    }
    return snapshot;
  })();

  walletInFlight = requestPromise;
  try {
    return clone(await requestPromise);
  } catch (error) {
    if (walletCache) {
      return clone(walletCache.data);
    }
    throw error;
  } finally {
    walletInFlight = null;
  }
}

export function getCachedRolleyStakeSnapshot() {
  if (!rolleyStakeCache || rolleyStakeCache.expiresAt <= Date.now()) return null;
  return clone(rolleyStakeCache.data);
}

export async function fetchRolleyStakeSnapshot(options?: { force?: boolean }) {
  await ensureActiveToken();

  const force = options?.force === true;
  if (!force && rolleyStakeCache && rolleyStakeCache.expiresAt > Date.now()) {
    return clone(rolleyStakeCache.data);
  }
  if (!force && rolleyStakeInFlight) {
    return clone(await rolleyStakeInFlight);
  }

  const requestPromise = (async () => {
    const current = await getCurrentUser();
    const user = current?.user || current;
    const userId = user?.id ? String(user.id) : "";
    if (!userId) {
      return { userId: "", stakes: [] } as RolleyStakeSnapshot;
    }
    const response = await fetchWithTimeout(
      buildRolleyUrl(`/api/v1/stakes?user_id=${encodeURIComponent(userId)}`)
    );
    if (!response.ok) {
      throw new Error(`Stake fetch failed (${response.status})`);
    }
    const data = await response.json();
    const snapshot: RolleyStakeSnapshot = {
      userId,
      stakes: Array.isArray(data?.stakes) ? data.stakes : [],
    };
    rolleyStakeCache = {
      data: snapshot,
      expiresAt: Date.now() + ROLLEY_STAKE_TTL_MS,
    };
    return snapshot;
  })();

  rolleyStakeInFlight = requestPromise;
  try {
    return clone(await requestPromise);
  } catch (error) {
    if (rolleyStakeCache) {
      return clone(rolleyStakeCache.data);
    }
    throw error;
  } finally {
    rolleyStakeInFlight = null;
  }
}

export async function warmAppBootstrap(options?: { force?: boolean }) {
  const token = await ensureActiveToken();
  if (!token) return;

  const force = options?.force === true;
  const now = Date.now();
  if (!force && bootstrapInFlight) {
    return bootstrapInFlight;
  }
  if (!force && now - lastBootstrapAt < BOOTSTRAP_COOLDOWN_MS) {
    return;
  }

  bootstrapInFlight = (async () => {
    await Promise.allSettled([
      getCurrentUser(),
      registerDevicePushToken(),
      fetchWalletOverview({ force }),
      fetchFeedSnapshot("posts", "forYou", { force }),
      fetchFeedSnapshot("banter", "hot", { force }),
      fetchRolleyStakeSnapshot({ force }),
    ]);
    void triggerBackgroundWalletRefresh(force);
    lastBootstrapAt = Date.now();
  })();

  try {
    await bootstrapInFlight;
  } finally {
    bootstrapInFlight = null;
  }
}
