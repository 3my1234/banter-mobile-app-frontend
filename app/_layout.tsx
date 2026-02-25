import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useColorScheme } from 'react-native';
import { PrivyProvider } from '@privy-io/expo';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const privyAppId =
    process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? 'REPLACE_ME_PRIVY_APP_ID';

  return (
    <PrivyProvider appId={privyAppId}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </PrivyProvider>
  );
}
