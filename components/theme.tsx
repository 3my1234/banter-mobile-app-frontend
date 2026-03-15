import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: "light" | "dark";
  setPreference: (next: ThemePreference) => Promise<void>;
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
