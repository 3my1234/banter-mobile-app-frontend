import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator, Alert } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { usePrivy, useLoginWithOAuth } from "@privy-io/expo";
import { useCreateWallet } from "@privy-io/expo/extended-chains";
import * as WebBrowser from "expo-web-browser";

// Point base URL directly at API root (includes /api to avoid double-prefix issues).
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";

const AuthLoginScreen = () => {
  const router = useRouter();
  const { user, isReady, getAccessToken } = usePrivy();
  const { login, state: oauthState } = useLoginWithOAuth();
  const { createWallet } = useCreateWallet();

  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const handledLoginRef = useRef(false);
  const userRef = useRef<any>(null);
  const authInFlightRef = useRef(false);
  const finalizedUserIdRef = useRef<string | null>(null);
  const walletCreateAttemptedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const validateStoredSession = async (token: string) => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        return res.ok;
      } catch {
        return false;
      }
    };

    const checkExistingSession = async () => {
      try {
        const raw = await SecureStore.getItemAsync("banter_session");
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const token = parsed?.token;
            if (typeof token === "string" && token.length > 0) {
              const valid = await validateStoredSession(token);
              if (valid) {
                setRedirecting(true);
                router.replace("/(tabs)");
                return;
              }
            }
          } catch {
            // ignore invalid JSON and clear below
          }
          await SecureStore.deleteItemAsync("banter_session");
          await sleep(50);
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

  const getBestEmail = (currentUser: any): string | undefined => {
    const direct = currentUser?.email?.address || currentUser?.email;
    if (typeof direct === "string" && direct.includes("@")) {
      return direct.trim().toLowerCase();
    }
    const accounts = getLinkedAccounts(currentUser);
    const fromLinked = accounts.find((account: any) => {
      const email = account?.email;
      return typeof email === "string" && email.includes("@");
    })?.email;
    if (typeof fromLinked === "string" && fromLinked.includes("@")) {
      return fromLinked.trim().toLowerCase();
    }
    return undefined;
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

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForAccounts = async (initialUser: any, maxAttempts: number = 8) => {
    let latestUser = initialUser;
    let accounts = getLinkedAccounts(latestUser);
    for (let i = 0; i < maxAttempts; i += 1) {
      const { movementAddress, solanaAddress } = ensureWallets(accounts);
      if (movementAddress && solanaAddress) {
        return { latestUser, accounts };
      }
      await sleep(250);
      latestUser = userRef.current || latestUser;
      accounts = getLinkedAccounts(latestUser);
    }
    return { latestUser, accounts };
  };

  const ensureWalletsForUser = async (initialUser: any) => {
    let latestUser = initialUser;
    let accounts = getLinkedAccounts(latestUser);
    let { movementAddress, solanaAddress } = ensureWallets(accounts);
    const userId = (latestUser?.id || "unknown").toString();
    let createdWallet = false;

    if (movementAddress && solanaAddress) {
      return {
        latestUser,
        accounts,
        movementAddress,
        solanaAddress,
        createdWallet,
        hasBothWallets: true,
      };
    }

    if (!walletCreateAttemptedRef.current[userId]) {
      walletCreateAttemptedRef.current[userId] = true;
      if (!createWallet) {
        return {
          latestUser,
          accounts,
          movementAddress,
          solanaAddress,
          createdWallet,
          hasBothWallets: false,
        };
      }

      if (!movementAddress) {
        const result = await createWallet({ chainType: "aptos" });
        if (result?.user) {
          latestUser = result.user as any;
          userRef.current = latestUser;
          createdWallet = true;
        }
      }

      if (!solanaAddress) {
        const result = await createWallet({ chainType: "solana" });
        if (result?.user) {
          latestUser = result.user as any;
          userRef.current = latestUser;
          createdWallet = true;
        }
      }
    }

    for (let i = 0; i < 12; i += 1) {
      accounts = getLinkedAccounts(userRef.current || latestUser);
      ({ movementAddress, solanaAddress } = ensureWallets(accounts));
      if (movementAddress && solanaAddress) {
        return {
          latestUser: userRef.current || latestUser,
          accounts,
          movementAddress,
          solanaAddress,
          createdWallet,
          hasBothWallets: true,
        };
      }
      await sleep(250);
    }

    return {
      latestUser,
      accounts,
      movementAddress,
      solanaAddress,
      createdWallet,
      hasBothWallets: false,
    };
  };

  const getPrivyTokenWithRetry = async (maxAttempts: number = 10) => {
    for (let i = 0; i < maxAttempts; i += 1) {
      const token = await getAccessToken();
      if (token) return token;
      await sleep(200);
    }
    return null;
  };

  const verifyPrivyWithRetry = async (privyToken: string, maxAttempts: number = 3) => {
    let lastError: unknown = null;
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        return await verifyPrivy(privyToken);
      } catch (error) {
        lastError = error;
        const msg = (error as Error)?.message || "";
        const isRetryable = msg.includes("(500)") || msg.toLowerCase().includes("failed to verify privy token");
        if (!isRetryable || i === maxAttempts - 1) {
          throw error;
        }
        await sleep(300 * (i + 1));
      }
    }
    throw lastError || new Error("Failed to verify privy token");
  };

  const processAuthenticatedUser = async (currentUser?: any) => {
    const activeUser = currentUser || userRef.current;
    if (!activeUser) return;
    const activeUserId = (activeUser?.id || "").toString();
    if (activeUserId && finalizedUserIdRef.current === activeUserId) return;
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    handledLoginRef.current = true;
    try {
      const email = getBestEmail(activeUser);

      const privyToken =
        (await getPrivyTokenWithRetry()) ||
        (activeUser as any)?.accessToken ||
        (activeUser as any)?.access_token ||
        (activeUser as any)?.authToken ||
        (activeUser as any)?.auth_token;

      if (!privyToken) {
        throw new Error("Privy token not available.");
      }

      let verified = await verifyPrivyWithRetry(privyToken);
      let latestUser = userRef.current || activeUser;
      let accounts = getLinkedAccounts(latestUser);
      ({ latestUser, accounts } = await waitForAccounts(latestUser));

      const walletResult = await ensureWalletsForUser(latestUser);
      if (walletResult.createdWallet) {
        const refreshedToken = (await getPrivyTokenWithRetry()) || privyToken;
        verified = await verifyPrivyWithRetry(refreshedToken);
      }

      if (!walletResult.hasBothWallets) {
        setLoginError("Wallet setup delayed. You can continue and sync wallets shortly.");
      }

      const sessionEmail = verified?.user?.email || email || "";
      await SecureStore.setItemAsync(
        "banter_session",
        JSON.stringify({ token: verified.token, email: sessionEmail })
      );
      if (activeUserId) {
        finalizedUserIdRef.current = activeUserId;
      }
      setRedirecting(true);
      router.replace("/(tabs)");
    } catch (error) {
      handledLoginRef.current = false;
      const msg = (error as Error)?.message ?? "Login failed";
      setLoginError(msg);
      Alert.alert("Login failed", msg);
    } finally {
      authInFlightRef.current = false;
    }
  };

  const startLogin = async () => {
    try {
      setLoginError(null);
      setLoginLoading(true);
      // Ensure any stale auth session is closed before starting a new one.
      try {
        await WebBrowser.dismissAuthSession();
      } catch {
        // ignore
      }
      if (isReady && userRef.current) {
        await processAuthenticatedUser(userRef.current);
        return;
      }
      const redirectUri = "/oauth";
      await login({ provider: "google", redirectUri });
    } catch (error) {
      const msg = (error as Error)?.message ?? "Login failed";
      if (msg.toLowerCase().includes("already logged in")) {
        if (userRef.current) {
          await processAuthenticatedUser(userRef.current);
          return;
        }
        setLoginError("Session detected. Finalizing login...");
        return;
      }
      if (msg.toLowerCase().includes("already has an account")) {
        if (userRef.current) {
          await processAuthenticatedUser(userRef.current);
          return;
        }
      }
      setLoginError(msg);
      Alert.alert("Login failed", msg);
    } finally {
      setLoginLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady || !user || handledLoginRef.current) return;
    processAuthenticatedUser(user);
  }, [isReady, user]);

  useEffect(() => {
    if (!oauthState || oauthState.status !== "error") return;
    const raw =
      (oauthState as any)?.error?.message ||
      (oauthState as any)?.error ||
      JSON.stringify((oauthState as any) || {});
    const msg = `OAuth error: ${raw}`;
    const lower = String(raw).toLowerCase();
    const recoverable =
      lower.includes("already logged in") ||
      lower.includes("already has an account");
    setLoginError(msg);
    if (!recoverable) {
      Alert.alert("OAuth error", msg);
    }

    // If Privy reports an existing session, finish login from current user state.
    if (recoverable && userRef.current) {
      processAuthenticatedUser(userRef.current);
    }
  }, [oauthState]);

  useEffect(() => {
    if (!oauthState || oauthState.status !== "done") return;
    if (handledLoginRef.current) return;

    let cancelled = false;
    const settle = async () => {
      for (let i = 0; i < 24; i += 1) {
        if (cancelled) return;
        if (userRef.current) {
          await processAuthenticatedUser(userRef.current);
          return;
        }
        await sleep(250);
      }
    };
    settle();
    return () => {
      cancelled = true;
    };
  }, [oauthState?.status]);

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
