import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { PrivyProvider } from '@privy-io/expo';
import * as WebBrowser from "expo-web-browser";
import { ThemePreferenceProvider, useThemePreference } from "@/components/theme";

WebBrowser.maybeCompleteAuthSession();

function RootLayoutInner() {
  const { resolvedTheme } = useThemePreference();
  const privyAppId =
    process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? 'REPLACE_ME_PRIVY_APP_ID';
  const privyClientId =
    process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? undefined;

  return (
    <PrivyProvider appId={privyAppId} clientId={privyClientId}>
      <ThemeProvider value={resolvedTheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </PrivyProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <RootLayoutInner />
    </ThemePreferenceProvider>
  );
}
