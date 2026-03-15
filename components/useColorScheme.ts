import { useThemePreference } from "./theme";

export function useColorScheme() {
  return useThemePreference().resolvedTheme;
}
