import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Video, ResizeMode } from "expo-av";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { pickMedia, presignUpload, uploadToS3, PickedMedia } from "@/lib/media";

const ROAST_PREFIX = "[ROAST]";

export default function ComposeScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"banter" | "roast">("banter");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [league, setLeague] = useState<string | null>(null);

  useEffect(() => {
    const loadLeagues = async () => {
      try {
        const data = await apiFetch("/leagues");
        const names = (data.leagues || []).map((l: any) => l.name);
        setLeagues(names);
      } catch {
        setLeagues([]);
      }
    };
    loadLeagues();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTagSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch(`/tags/search?q=${encodeURIComponent(q)}`);
        const results = (data.tags || []).map((t: any) => t.name || t.tag || t);
        setTagSuggestions(results.slice(0, 8));
      } catch {
        setTagSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const addTag = (value: string) => {
    const raw = value.replace(/^#/, "").trim();
    if (!raw) return;
    if (tags.includes(raw)) return;
    setTags((prev) => [...prev, raw]);
    setQuery("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handlePick = async (kind: "image" | "video") => {
    const picked = await pickMedia(kind);
    if (picked) setMedia(picked);
  };

  const handleSubmit = async () => {
    if (!text.trim()) {
      setError("Post content is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let mediaUrl: string | undefined;
      let mediaType: "image" | "video" | undefined;
      if (media) {
        const presign = await presignUpload(
          media.fileName,
          media.mimeType,
          "post"
        );
        await uploadToS3(presign.uploadUrl, media.uri, media.mimeType);
        mediaUrl = presign.viewUrl;
        mediaType = media.isVideo ? "video" : "image";
      }

      const content =
        mode === "roast" ? `${ROAST_PREFIX} ${text.trim()}` : text.trim();

      await apiFetch("/posts", {
        method: "POST",
        body: JSON.stringify({
          content,
          mediaUrl,
          mediaType,
          isRoast: mode === "roast",
          tags,
          league,
        }),
      });

      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <FontAwesome name="close" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.title}>Create</Text>
          <Pressable style={styles.postBtn} onPress={handleSubmit} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#0d0d0d" />
            ) : (
              <Text style={styles.postText}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.modePill}>
            <Pressable
              onPress={() => setMode("banter")}
              style={[styles.modeBtn, mode === "banter" && styles.modeActive]}
            >
              <Text style={styles.modeText}>Post</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("roast")}
              style={[styles.modeBtn, mode === "roast" && styles.modeActive]}
            >
              <Text style={styles.modeText}>Roast</Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            placeholder="What's the banter?"
            placeholderTextColor="#777"
            multiline
            value={text}
            onChangeText={setText}
          />

          {media ? (
            <View style={styles.mediaPreview}>
              {media.isVideo ? (
                <Video
                  source={{ uri: media.uri }}
                  style={styles.media}
                  resizeMode={ResizeMode.COVER}
                  useNativeControls
                />
              ) : (
                <ExpoImage
                  source={{ uri: media.uri }}
                  style={styles.media}
                  contentFit="cover"
                  transition={180}
                />
              )}
              <Pressable onPress={() => setMedia(null)}>
                <Text style={styles.removeMedia}>Remove media</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable onPress={() => handlePick("image")}>
              <FontAwesome name="image" size={18} color="#ff6b35" />
            </Pressable>
            <Pressable onPress={() => handlePick("video")}>
              <FontAwesome name="video-camera" size={18} color="#ff6b35" />
            </Pressable>
          </View>

          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>League</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.leagueRow}>
                {leagues.map((l) => (
                  <Pressable
                    key={l}
                    style={[
                      styles.leagueChip,
                      league === l && styles.leagueChipActive,
                    ]}
                    onPress={() => setLeague(league === l ? null : l)}
                  >
                    <Text
                      style={[
                        styles.leagueText,
                        league === l && styles.leagueTextActive,
                      ]}
                    >
                      {l}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Tags</Text>
            <TextInput
              style={styles.tagInput}
              placeholder="Search club or add #tag"
              placeholderTextColor="#777"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => {
                if (query.trim()) addTag(query.trim());
              }}
            />
            <View style={styles.tagsRow}>
              {tags.map((tag) => (
                <Pressable
                  key={tag}
                  style={styles.tagChip}
                  onPress={() => removeTag(tag)}
                >
                  <Text style={styles.tagText}>#{tag}</Text>
                </Pressable>
              ))}
            </View>
            {tagSuggestions.length ? (
              <View style={styles.suggestions}>
                {tagSuggestions.map((club) => (
                  <Pressable
                    key={club}
                    style={styles.suggestionItem}
                    onPress={() => addTag(club)}
                  >
                    <Text style={styles.suggestionText}>{club}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  title: { color: "#fff", fontWeight: "700", fontSize: 16 },
  postBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  postText: { color: "#0d0d0d", fontWeight: "700" },
  content: { padding: 16, gap: 14 },
  modePill: {
    flexDirection: "row",
    backgroundColor: "#151515",
    borderRadius: 999,
    padding: 2,
    alignSelf: "flex-start",
  },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modeActive: { backgroundColor: "#ff6b35" },
  modeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  input: {
    color: "#fafafa",
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 16,
  },
  mediaPreview: { gap: 8 },
  media: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12 },
  removeMedia: { color: "#ff6b35", fontWeight: "700" },
  actionsRow: { flexDirection: "row", gap: 16, marginTop: 6 },
  tagsSection: { gap: 10 },
  sectionTitle: { color: "#fff", fontWeight: "700" },
  leagueRow: { flexDirection: "row", gap: 8 },
  leagueChip: {
    backgroundColor: "#151515",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  leagueChipActive: { backgroundColor: "#ff6b35" },
  leagueText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  leagueTextActive: { color: "#0d0d0d", fontWeight: "700" },
  tagInput: {
    borderColor: "#1f1f1f",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
  },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    backgroundColor: "#1f1f1f",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagText: { color: "#ff6b35", fontWeight: "700" },
  suggestions: {
    borderColor: "#1f1f1f",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  suggestionText: { color: "#fafafa" },
  error: { color: "#ff6b35" },
});
