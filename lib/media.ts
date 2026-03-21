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

function toPickedMedia(
  asset: ImagePicker.ImagePickerAsset,
  fallbackPrefix: string
): PickedMedia {
  const fileName =
    asset.fileName ||
    `${fallbackPrefix}-${Date.now()}.${asset.type === "video" ? "mp4" : "jpg"}`;
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
  return toPickedMedia(asset, "banter");
}

export async function pickMultipleImages(
  maxSelection: number = 6
): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
    allowsEditing: false,
    allowsMultipleSelection: true,
    selectionLimit: maxSelection,
  } as ImagePicker.ImagePickerOptions);

  if (result.canceled || !result.assets?.length) return [];

  return result.assets
    .slice(0, maxSelection)
    .map((asset) => toPickedMedia(asset, "banter"));
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
  return toPickedMedia(asset, "banter");
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

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const MEDIA_BASE =
  process.env.EXPO_PUBLIC_MEDIA_BASE_URL ?? "https://media.sportbanter.online";
const MEDIA_BASE_URL = MEDIA_BASE.replace(/\/+$/, "");

function toCdnUrl(keyOrPath: string) {
  const normalized = keyOrPath.replace(/^\/+/, "");
  return `${MEDIA_BASE_URL}/${normalized}`;
}

function toBackendPublicViewUrl(keyOrPath: string) {
  const normalized = keyOrPath
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${API_ORIGIN}/api/public/images/view/${normalized}`;
}

function extractCdnPathFromS3(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function replaceHlsManifestWithMp4(url: string) {
  if (!/\.m3u8($|\?)/i.test(url)) return url;
  const [base, query = ""] = url.split("?");
  const nextBase = base.replace(/[^/]+\.m3u8$/i, "download.mp4");
  return query ? `${nextBase}?${query}` : nextBase;
}

function inferFileExtension(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase() || fallback;
  } catch {
    return fallback;
  }
}

function extractMediaKey(url?: string | null) {
  if (!url) return "";

  const viewPrefix = "/api/images/view/";
  const publicViewPrefix = "/api/public/images/view/";

  if (url.includes(publicViewPrefix) || url.includes(viewPrefix)) {
    const targetPrefix = url.includes(publicViewPrefix) ? publicViewPrefix : viewPrefix;
    const idx = url.indexOf(targetPrefix);
    return decodeURIComponent(url.slice(idx + targetPrefix.length).replace(/^\/+/, ""));
  }

  if (/^https?:\/\/.+\.s3[.-].*amazonaws\.com\//i.test(url)) {
    return extractCdnPathFromS3(url);
  }

  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return url.replace(/^\/+/, "");
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

function resolvePlayableMediaUrl(url?: string | null) {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return undefined;
  return replaceHlsManifestWithMp4(normalized);
}

async function resolveDownloadableMediaUrl(url?: string | null) {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return undefined;

  const result = (await apiFetch(
    "/media/download-url",
    {
      method: "POST",
      body: JSON.stringify({
        mediaUrl: url || normalized,
      }),
    },
    true
  )) as {
    success?: boolean;
    downloadUrl?: string;
    key?: string;
    strategy?: string;
  };

  if (typeof result?.downloadUrl === "string" && result.downloadUrl) {
    return result.downloadUrl;
  }

  const key = extractMediaKey(url) || extractMediaKey(normalized);
  if (key) return toBackendPublicViewUrl(key);
  return normalized;
}

export async function saveMediaToLibrary(
  url: string,
  options?: {
    albumName?: string;
    fileNamePrefix?: string;
    preferredExtension?: string;
  }
) {
  const sourceUrl = await resolveDownloadableMediaUrl(url);
  if (!sourceUrl) {
    throw new Error("Media URL is missing.");
  }

  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Permission denied");
  }

  let downloadUrl = sourceUrl;

  const lowerUrl = downloadUrl.toLowerCase();
  const fallbackExt =
    options?.preferredExtension ||
    (lowerUrl.includes(".mp4") ? "mp4" : "jpg");
  const extension = options?.preferredExtension || inferFileExtension(downloadUrl, fallbackExt);
  const prefix = options?.fileNamePrefix || "banter";
  const albumName = options?.albumName || "Banter";
  const fileUri = `${FileSystem.documentDirectory}${prefix}-${Date.now()}.${extension}`;
  const download = await FileSystem.downloadAsync(downloadUrl, fileUri);
  if (download.status < 200 || download.status >= 300) {
    throw new Error(`Download failed (${download.status})`);
  }

  const asset = await MediaLibrary.createAssetAsync(download.uri);
  await MediaLibrary.createAlbumAsync(albumName, asset, false).catch(() => {});
  return asset.uri;
}
