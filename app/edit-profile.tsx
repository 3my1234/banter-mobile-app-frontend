import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image as ExpoImage } from "expo-image";
import { Text } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { normalizeMediaUrl, pickMedia, presignUpload, uploadToS3 } from "@/lib/media";

export default function EditProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [bannerUrl, setBannerUrl] = useState<string | undefined>();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [clubs, setClubs] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch("/auth/me", undefined, true);
        const user = data.user || data;
        setAvatarUrl(normalizeMediaUrl(user.avatarUrl));
        setBannerUrl(normalizeMediaUrl(user.bannerUrl));
        setDisplayName(user.displayName || "");
        setUsername(user.username || "");
        setBio(user.bio || "");
        setPhone(user.phone || "");
        setCountry(user.country || "");
        setDateOfBirth(user.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : "");
        setClubs(Array.isArray(user.clubs) ? user.clubs.join(", ") : "");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const uploadImage = async (type: "profile" | "banner") => {
    try {
      setSaving(true);
      setError(null);
      const picked = await pickMedia("image");
      if (!picked) return;
      const presign = await presignUpload(picked.fileName, picked.mimeType, type);
      await uploadToS3(presign.uploadUrl, picked.uri, picked.mimeType);
      const nextUrl = normalizeMediaUrl(presign.viewUrl);
      if (type === "profile") {
        setAvatarUrl(nextUrl);
      } else {
        setBannerUrl(nextUrl);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const clubsArray = clubs
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      await apiFetch(
        "/auth/me",
        {
          method: "PATCH",
          body: JSON.stringify({
            displayName,
            username,
            bio,
            phone,
            country,
            dateOfBirth: dateOfBirth || null,
            clubs: clubsArray,
            avatarUrl: avatarUrl || null,
            bannerUrl: bannerUrl || null,
          }),
        },
        true
      );
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <View style={styles.headerSpacer} />
        <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#0d0d0d" />
          ) : (
            <Text style={styles.saveText}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 24 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.bannerWrap}>
            {bannerUrl ? (
              <ExpoImage
                source={{ uri: bannerUrl }}
                style={styles.banner}
                contentFit="cover"
                transition={180}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={styles.bannerPlaceholder} />
            )}
            <Pressable style={styles.editBadge} onPress={() => uploadImage("banner")}>
              <FontAwesome name="camera" size={14} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.avatarBlock}>
            <View>
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
              <Pressable style={styles.avatarEdit} onPress={() => uploadImage("profile")}>
                <FontAwesome name="camera" size={12} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#777"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              placeholderTextColor="#777"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell the world about you"
              placeholderTextColor="#777"
              multiline
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+234..."
              placeholderTextColor="#777"
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Country</Text>
            <TextInput
              style={styles.input}
              value={country}
              onChangeText={setCountry}
              placeholder="Country"
              placeholderTextColor="#777"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Date of birth</Text>
            <TextInput
              style={styles.input}
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#777"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Clubs supported</Text>
            <TextInput
              style={styles.input}
              value={clubs}
              onChangeText={setClubs}
              placeholder="Arsenal, Barcelona"
              placeholderTextColor="#777"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d0d0d" },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#1d1d1d",
    borderBottomWidth: 1,
  },
  headerSpacer: { width: 18 },
  headerTitle: { color: "#fff", fontWeight: "700", fontSize: 16 },
  saveBtn: {
    backgroundColor: "#ff6b35",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  saveText: { color: "#0d0d0d", fontWeight: "700" },
  content: { padding: 16, gap: 14 },
  bannerWrap: { borderRadius: 16, overflow: "hidden" },
  banner: { width: "100%", height: 140 },
  bannerPlaceholder: { width: "100%", height: 140, backgroundColor: "#1f1f1f" },
  editBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBlock: { marginTop: -36, marginBottom: 8 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: "#0d0d0d",
    backgroundColor: "#1f1f1f",
  },
  avatarEdit: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  field: { gap: 6 },
  label: { color: "#fff", fontWeight: "600" },
  input: {
    backgroundColor: "#151515",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  error: { color: "#ff6b35" },
  muted: { color: "#999", marginTop: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});

