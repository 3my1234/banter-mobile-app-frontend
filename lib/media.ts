import * as ImagePicker from "expo-image-picker";
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

export async function uploadToS3(uploadUrl: string, uri: string, mimeType: string) {
  const blob = await fetch(uri).then((r) => r.blob());
  const sizeMb = blob.size / (1024 * 1024);
  if (mimeType.startsWith("image/") && sizeMb > MAX_IMAGE_SIZE_MB) {
    throw new Error(`Image must be <= ${MAX_IMAGE_SIZE_MB}MB`);
  }

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: blob,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}) ${text}`);
  }
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
  if (normalized.startsWith("http://localhost") || normalized.startsWith("http://127.") || normalized.startsWith("http://0.0.0.0")) {
    normalized = normalized.replace(/^http:\/\/[^/]+/, API_ORIGIN);
  }
  if (normalized.startsWith("/api/")) {
    normalized = `${API_ORIGIN}${normalized}`;
  }
  if (normalized.includes(viewPrefix)) {
    const idx = normalized.indexOf(viewPrefix);
    const key = normalized.slice(idx + viewPrefix.length).replace(/^\/+/, "");
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
