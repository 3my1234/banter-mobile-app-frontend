import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark";
  setPreference: (next: ThemePreference) => Promise<void>;
};

export type AppThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  textSoft: string;
  input: string;
  overlay: string;
  overlayStrong: string;
};

const STORAGE_KEY = "banter_theme_preference";
const ThemePreferenceContext = createContext<ThemeContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() ?? "dark";
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreferenceState(stored);
        }
      } catch {
        // ignore
      }
    };
    load();
  }, []);

  const setPreference = async (next: ThemePreference) => {
    setPreferenceState(next);
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const resolvedTheme =
    preference === "system" ? (systemScheme ?? "dark") : preference;

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme]
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error("ThemePreferenceProvider is missing.");
  }
  return ctx;
}

export function useAppThemeColors(): AppThemeColors {
  const { resolvedTheme } = useThemePreference();

  return useMemo(() => {
    if (resolvedTheme === "light") {
      return {
        background: "#e0e0e0",
        surface: "#f2f2f2",
        surfaceAlt: "#e8e8e8",
        border: "#c9c9c9",
        borderStrong: "#b0b0b0",
        text: "#111111",
        textMuted: "#444444",
        textSubtle: "#555555",
        textSoft: "#2b2b2b",
        input: "#f7f7f7",
        overlay: "rgba(0,0,0,0.55)",
        overlayStrong: "rgba(0,0,0,0.75)",
      };
    }

    return {
      background: "#0d0d0d",
      surface: "#151515",
      surfaceAlt: "#111111",
      border: "#1d1d1d",
      borderStrong: "#333333",
      text: "#fafafa",
      textMuted: "#888888",
      textSubtle: "#999999",
      textSoft: "#cbd5f5",
      input: "#141414",
      overlay: "rgba(0,0,0,0.55)",
      overlayStrong: "rgba(0,0,0,0.85)",
    };
  }, [resolvedTheme]);
}
