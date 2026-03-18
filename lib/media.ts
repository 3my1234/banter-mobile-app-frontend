import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { apiFetch, API_BASE_URL } from "./api";

type PresignResponse = {
  success: boolean;
  uploadUrl: string;
  key: string;
  viewUrl: string;
};

export type PickedMedia = {
  uri: string;
  mimeType: string;
  fileName: string;
  isVideo: boolean;
};

const MAX_IMAGE_SIZE_MB = 10;

export async function pickMedia(
  kind: "image" | "video" | "both"
): Promise<PickedMedia | null> {
  const mediaTypes =
    (kind === "image"
      ? ["images"]
      : kind === "video"
      ? ["videos"]
      : ["images", "videos"]) as ImagePicker.ImagePickerOptions["mediaTypes"];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes,
    quality: 0.9,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const fileName =
    asset.fileName ||
    `banter-${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`;
  const mimeType =
    asset.mimeType ||
    (asset.type === "video" ? "video/mp4" : "image/jpeg");

  return {
    uri: asset.uri,
    mimeType,
    fileName,
    isVideo: asset.type === "video",
  };
}

export async function captureMedia(
  kind: "image" | "video"
): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Camera permission is required to record media.");
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: (kind === "video" ? ["videos"] : ["images"]) as ImagePicker.ImagePickerOptions["mediaTypes"],
    quality: 0.9,
    allowsEditing: false,
    videoMaxDuration: 60,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const fileName =
    asset.fileName ||
    `banter-${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`;
  const mimeType =
    asset.mimeType ||
    (asset.type === "video" ? "video/mp4" : "image/jpeg");

  return {
    uri: asset.uri,
    mimeType,
    fileName,
    isVideo: asset.type === "video",
  };
}

export async function presignUpload(
  fileName: string,
  mimeType: string,
  type: "profile" | "banner" | "post"
): Promise<PresignResponse> {
  const data = await apiFetch(
    "/images/presign",
    {
      method: "POST",
      body: JSON.stringify({
        filename: fileName,
        mimeType,
        type,
      }),
    },
    true
  );
  return data as PresignResponse;
}

export async function uploadToS3(
  uploadUrl: string,
  uri: string,
  mimeType: string,
  onProgress?: (progress: number) => void
) {
  const blob = await fetch(uri).then((r) => r.blob());
  const sizeMb = blob.size / (1024 * 1024);
  if (mimeType.startsWith("image/") && sizeMb > MAX_IMAGE_SIZE_MB) {
    throw new Error(`Image must be <= ${MAX_IMAGE_SIZE_MB}MB`);
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      const bounded = Math.max(0, Math.min(100, percent));
      onProgress?.(Number.isFinite(bounded) ? bounded : 0);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}) ${xhr.responseText || ""}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(blob);
  });
}

export function isStreamMediaUrl(url?: string | null) {
  return !!url && /\.m3u8($|[?#])/i.test(url);
}

export function isPendingProcessedVideoUrl(url?: string | null) {
  if (!url) return false;
  return /\/post\/branded\//i.test(url) && !isStreamMediaUrl(url);
}

export function getDownloadableMediaUrl(url: string) {
  if (isStreamMediaUrl(url)) {
    return url.replace(/\/index\.m3u8($|[?#].*)/i, "/download.mp4$1");
  }
  return url;
}

export async function saveRemoteMediaToLibrary(url: string) {
  if (isPendingProcessedVideoUrl(url)) {
    throw new Error("This video is still processing. Wait for the Banter outro version to finish.");
  }
  const targetUrl = getDownloadableMediaUrl(url);

  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Permission denied");
  }

  const ext = targetUrl.split(".").pop()?.split("?")[0] || "jpg";
  const fileUri = `${FileSystem.documentDirectory}banter-${Date.now()}.${ext}`;
  const download = await FileSystem.downloadAsync(targetUrl, fileUri);
  await MediaLibrary.saveToLibraryAsync(download.uri);
  const asset = await MediaLibrary.createAssetAsync(download.uri).catch(() => null);
  if (asset) {
    const album = await MediaLibrary.getAlbumAsync("Banter");
    if (album) {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false).catch(() => {});
    } else {
      await MediaLibrary.createAlbumAsync("Banter", asset, false).catch(() => {});
    }
  }
  return { localUri: download.uri, targetUrl };
}

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const MEDIA_BASE =
  process.env.EXPO_PUBLIC_MEDIA_BASE_URL ?? "https://media.sportbanter.online";
const MEDIA_BASE_URL = MEDIA_BASE.replace(/\/+$/, "");

function toCdnUrl(keyOrPath: string) {
  const normalized = keyOrPath.replace(/^\/+/, "");
  return `${MEDIA_BASE_URL}/${normalized}`;
}

function extractCdnPathFromS3(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}

export function normalizeMediaUrl(url?: string | null) {
  if (!url) return undefined;
  let normalized = url;
  const viewPrefix = "/api/images/view/";
  const publicViewPrefix = "/api/public/images/view/";
  if (normalized.startsWith("http://localhost") || normalized.startsWith("http://127.") || normalized.startsWith("http://0.0.0.0")) {
    normalized = normalized.replace(/^http:\/\/[^/]+/, API_ORIGIN);
  }
  if (normalized.startsWith("/api/")) {
    normalized = `${API_ORIGIN}${normalized}`;
  }
  if (normalized.includes(publicViewPrefix) || normalized.includes(viewPrefix)) {
    const targetPrefix = normalized.includes(publicViewPrefix) ? publicViewPrefix : viewPrefix;
    const idx = normalized.indexOf(targetPrefix);
    const key = normalized.slice(idx + targetPrefix.length).replace(/^\/+/, "");
    if (key) {
      return toCdnUrl(key);
    }
  }
  if (/^https?:\/\/.+\.s3[.-].*amazonaws\.com\//i.test(normalized)) {
    const path = extractCdnPathFromS3(normalized);
    if (path) return toCdnUrl(path);
  }
  if (!/^https?:\/\//.test(normalized)) {
    const trimmed = normalized.replace(/^\/+/, "");
    normalized = toCdnUrl(trimmed);
  }
  return normalized;
}
