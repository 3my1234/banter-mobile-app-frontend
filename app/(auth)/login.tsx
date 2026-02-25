import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { usePrivy, useLoginWithOAuth } from "@privy-io/expo";
import { useCreateWallet } from "@privy-io/expo/extended-chains";

// Point base URL directly at API root (includes /api to avoid double-prefix issues).
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";

type PendingRegistration = {
  email: string;
  solanaAddress: string;
  movementAddress: string;
  userInfo: any;
};

const AuthLoginScreen = () => {
  const router = useRouter();
  const privy = usePrivy();
  const { user, authenticated } = privy;
  const { login, state: oauthState } = useLoginWithOAuth();
  const { createWallet } = useCreateWallet();

  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const handledLoginRef = useRef(false);

  useEffect(() => {
    const checkExistingSession = async () => {
      try {
        const raw = await SecureStore.getItemAsync("banter_session");
        if (raw) {
          setRedirecting(true);
          router.replace("/(tabs)");
          return;
        }
      } finally {
        setCheckingSession(false);
        setIsInitializing(false);
      }
    };
    checkExistingSession();
  }, [router]);

  const verifyPrivy = async (privyToken: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/privy/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privyToken }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Privy verify failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<{ token: string; user: any }>;
  };

  const getLinkedAccounts = (currentUser: any) => {
    return currentUser?.linkedAccounts || currentUser?.linked_accounts || [];
  };

  const findWalletAddress = (accounts: any[], chainType: string) => {
    const wallet = accounts.find(
      (account: any) =>
        account?.type === "wallet" &&
        (account?.chainType === chainType || account?.chain_type === chainType)
    );
    return wallet?.address as string | undefined;
  };

  const ensureWallets = (accounts: any[]) => {
    const movementAddress =
      findWalletAddress(accounts, "aptos") || findWalletAddress(accounts, "movement");
    const solanaAddress = findWalletAddress(accounts, "solana");
    return { movementAddress, solanaAddress };
  };

  const processAuthenticatedUser = async () => {
    if (!authenticated || !user) return;
    handledLoginRef.current = true;
    try {
      const email = user?.email?.address?.trim();
      if (!email || !email.includes("@")) {
        throw new Error("Login failed: Google email was not returned.");
      }

      let latestUser = user;
      let accounts = getLinkedAccounts(latestUser);
      let { movementAddress, solanaAddress } = ensureWallets(accounts);

      if (!movementAddress || !solanaAddress) {
        if (!createWallet) {
          throw new Error("Wallets not found. Privy wallet creation unavailable.");
        }

          if (!movementAddress) {
            const result = await createWallet({ chainType: "aptos" });
            if (result?.user) latestUser = result.user as any;
          }
          if (!solanaAddress) {
            const result = await createWallet({ chainType: "solana" });
            if (result?.user) latestUser = result.user as any;
          }

          const refreshedUser = (privy as any)?.user || latestUser;
          accounts = getLinkedAccounts(refreshedUser);
        ({ movementAddress, solanaAddress } = ensureWallets(accounts));
      }

      if (!movementAddress || !solanaAddress) {
        throw new Error("Wallets not found. Please retry login.");
      }

      const privyToken =
        (await (privy as any)?.getAccessToken?.()) ||
        (user as any)?.accessToken ||
        (user as any)?.access_token ||
        (user as any)?.authToken ||
        (user as any)?.auth_token;

      if (!privyToken) {
        throw new Error("Privy token not available.");
      }

      const verified = await verifyPrivy(privyToken);
      await SecureStore.setItemAsync(
        "banter_session",
        JSON.stringify({ token: verified.token, email })
      );
      setRedirecting(true);
      router.replace("/(tabs)");
    } catch (error) {
      handledLoginRef.current = false;
      const msg = (error as Error)?.message ?? "Login failed";
      setLoginError(msg);
      Alert.alert("Login failed", msg);
    }
  };

  const startLogin = async () => {
    try {
      setLoginError(null);
      setLoginLoading(true);
      if (authenticated && user) {
        try {
          await processAuthenticatedUser();
          return;
        } catch {
          // If session exists but we can't proceed, reset and retry login.
          await privy.logout();
        }
      }
      const redirectUri = "https://sportbanter.online/privy/oauth";
      const result = await login({ provider: "google", redirectUri });
      if (!result) {
        throw new Error("Login did not start. Please try again.");
      }
    } catch (error) {
      const msg = (error as Error)?.message ?? "Login failed";
      if (msg.toLowerCase().includes("already logged in")) {
        await processAuthenticatedUser();
        return;
      }
      setLoginError(msg);
      Alert.alert("Login failed", msg);
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (!authenticated || !user || handledLoginRef.current) return;
    processAuthenticatedUser();
  }, [authenticated, user]);

  if (checkingSession || redirecting) {
    return (
      <View style={styles.container}>
        <Image
          source={require("../../assets/images/banter-logo.jpg")}
          style={styles.logo}
        />
        <ActivityIndicator color="#ff6b35" />
        <Text style={styles.errorText}>Signing you in…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/images/banter-logo.jpg")}
        style={styles.logo}
      />
      {oauthState?.status ? (
        <Text style={styles.mutedText}>OAuth: {oauthState.status}</Text>
      ) : null}
      {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
      <Pressable
        style={[styles.googleButton, loginLoading && styles.googleButtonDisabled]}
        onPress={startLogin}
        disabled={loginLoading || isInitializing}
      >
        {loginLoading ? (
          <>
            <ActivityIndicator color="#0d0d0d" />
            <Text style={styles.googleButtonText}>Signing you in...</Text>
          </>
        ) : (
          <>
            <FontAwesome name="google" size={18} color="#111" />
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </>
        )}
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 24,
  },
  errorText: {
    color: "#ff6b35",
    textAlign: "center",
    marginBottom: 8,
  },
  mutedText: {
    color: "#666",
    marginBottom: 8,
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
  },
  googleButtonDisabled: {
    opacity: 0.6,
  },
  googleButtonText: {
    color: "#111",
    fontWeight: "700",
  },
});

export default AuthLoginScreen;
