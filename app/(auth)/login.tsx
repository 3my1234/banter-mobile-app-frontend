import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import Web3Auth from "@web3auth/react-native-sdk";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/base";
import { SolanaPrivateKeyProvider } from "@web3auth/solana-provider";
import { Keypair } from "@solana/web3.js";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Buffer } from "buffer";

const WEB3AUTH_CLIENT_ID =
  process.env.EXPO_PUBLIC_WEB3AUTH_CLIENT_ID ??
  "REPLACE_ME_WEB3AUTH_CLIENT_ID";
const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
  "228247426621-vgpr7j31fsl6na1ugjlhj2c9cmb7b2vh.apps.googleusercontent.com";
const WEB3AUTH_VERIFIER =
  process.env.EXPO_PUBLIC_WEB3AUTH_VERIFIER ?? "banter-app";
// Use a real route that exists in the router: "/login"
// (Deep links don't include group names like (auth), so path is just /login)
const REDIRECT_URL =
  process.env.EXPO_PUBLIC_WEB3AUTH_REDIRECT_URL ?? "banterv3://login";

// Point base URL directly at API root (includes /api to avoid double-prefix issues).
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://sportbanter.online/api";

const CHAIN_CONFIG = {
  chainNamespace: CHAIN_NAMESPACES.SOLANA,
  chainId: "0x3",
  rpcTarget: "https://api.devnet.solana.com",
  displayName: "Solana Devnet",
  blockExplorer: "https://explorer.solana.com/?cluster=devnet",
  ticker: "SOL",
  tickerName: "Solana",
};

type PendingRegistration = {
  email: string;
  solanaAddress: string;
  movementAddress: string;
  userInfo: any;
};

const AuthLoginScreen = () => {
  const router = useRouter();
  const [web3auth, setWeb3auth] = useState<Web3Auth | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [initAttempts, setInitAttempts] = useState<number>(0);
  const [checkingSession, setCheckingSession] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

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
      }
    };
    checkExistingSession();
  }, [router]);

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();

    const initWeb3Auth = async () => {
      setIsInitializing(true);
      setInitError(null);
      try {
        const privateKeyProvider = new SolanaPrivateKeyProvider({
          config: { chainConfig: CHAIN_CONFIG },
        });

        const instance = new Web3Auth(WebBrowser, SecureStore, {
          clientId: WEB3AUTH_CLIENT_ID,
          network: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
          redirectUrl: REDIRECT_URL,
          loginConfig: {
            google: {
              verifier: WEB3AUTH_VERIFIER,
              typeOfLogin: "google",
              clientId: GOOGLE_CLIENT_ID,
              extraLoginOptions: {
                scope: "openid email profile",
              },
            },
          },
          privateKeyProvider,
        });

        const initPromise = instance.init();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Web3Auth init timed out")), 45000)
        );
        await Promise.race([initPromise, timeoutPromise]);
        setWeb3auth(instance);
      } catch (error) {
        setInitError((error as Error)?.message ?? "Web3Auth init failed");
      } finally {
        setIsInitializing(false);
      }
    };

    initWeb3Auth();
  }, [initAttempts]);

  const deriveAddresses = (key: string) => {
    const seed = Buffer.from(key, "hex");
    if (seed.length !== 32) {
      throw new Error(`Expected 32-byte key, got ${seed.length}`);
    }
    // Solana: Web3Auth returns a 32-byte seed; use fromSeed (not fromSecretKey)
    const solanaKeypair = Keypair.fromSeed(seed);
    const solanaAddress = solanaKeypair.publicKey.toBase58();
    // Movement (Aptos): Ed25519PrivateKey takes 32-byte seed
    const privateKeyAptos = new Ed25519PrivateKey(seed);
    const movementAccount = Account.fromPrivateKey({
      privateKey: privateKeyAptos,
    });
    const movementAddress = movementAccount.accountAddress.toString();
    return { solanaAddress, movementAddress };
  };

  const checkUserExists = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      throw new Error(`Auth check failed (${res.status})`);
    }
    return res.json() as Promise<{ exists: boolean; token?: string }>;
  };

  const loginExistingUser = async (email: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      throw new Error(`Login failed (${res.status})`);
    }
    return res.json() as Promise<{ token: string }>;
  };

  const normalizePrivateKeyHex = (pk: string): string => {
    let key = pk.trim();
    if (key.startsWith("0x")) key = key.slice(2);

    const isHex = /^[0-9a-fA-F]+$/.test(key);
    if (isHex) {
      if (key.length < 64) {
        throw new Error("Private key hex too short");
      }
      if (key.length > 64) {
        key = key.slice(-64); // keep last 32 bytes
      }
      return key;
    }

    const isMaybeB64 =
      /^[A-Za-z0-9+/=]+$/.test(key) && key.length % 4 === 0 && key.length >= 44;
    if (isMaybeB64) {
      const buf = Buffer.from(key, "base64");
      let hex = buf.toString("hex");
      if (hex.length > 64) hex = hex.slice(-64);
      if (hex.length < 64) throw new Error("Private key base64 too short");
      return hex;
    }

    throw new Error("Unsupported private key format");
  };

  const decodeJwtEmail = (token?: string | null): string | null => {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padLen = padded.length % 4;
      const base64 = padded + (padLen ? "=".repeat(4 - padLen) : "");
      const json = Buffer.from(base64, "base64").toString("utf8");
      const payload = JSON.parse(json);
      const email = (payload?.email as string | undefined)?.trim();
      return email && email.includes("@") ? email : null;
    } catch {
      return null;
    }
  };

  const login = async () => {
    try {
      setLoginError(null);
      if (!web3auth) {
        setLoginError("Web3Auth not initialized.");
        return;
      }
      setLoginLoading(true);

      const loginResult = await web3auth.login({ loginProvider: "google" });

      // Try multiple ways to get profile (email / verifierId)
      const runtimeGetUserInfo = (web3auth as any)?.getUserInfo;
      const providerGetUserInfo =
        web3auth.provider?.request?.({ method: "getUserInfo" }).catch(() => undefined);
      let profile: any =
        (web3auth as any)?.userInfo ??
        (typeof runtimeGetUserInfo === "function"
          ? await runtimeGetUserInfo.call(web3auth).catch(() => undefined)
          : undefined) ??
        (await providerGetUserInfo) ??
        (loginResult as any)?.userInfo ??
        (loginResult as any);

      if (!web3auth.provider) {
        throw new Error("No provider available after login");
      }

      const privateKeyHex = await web3auth.provider.request({
        method: "private_key",
      });
      const normalized = normalizePrivateKeyHex(privateKeyHex as string);
      console.log("Private key (raw len)", (privateKeyHex as string)?.length);
      console.log("Private key (normalized len)", normalized.length);
      await SecureStore.setItemAsync("banter_private_key", normalized);
      const { solanaAddress, movementAddress } = deriveAddresses(normalized);

      const idToken =
        (loginResult as any)?.idToken ||
        (loginResult as any)?.oauthIdToken ||
        (profile as any)?.idToken ||
        (profile as any)?.oauthIdToken;
      const email =
        (profile?.email as string | undefined)?.trim() ||
        decodeJwtEmail(idToken);
      if (!email || !email.includes("@")) {
        throw new Error(
          "Login failed: Google email was not returned. Please log in again."
        );
      }

      const check = await checkUserExists(email);
      if (check.exists) {
        const token = check.token
          ? check.token
          : (await loginExistingUser(email)).token;
        await SecureStore.setItemAsync(
          "banter_session",
          JSON.stringify({
            token,
            email,
          })
        );
        setRedirecting(true);
        router.replace("/(tabs)");
      } else {
        const pending: PendingRegistration = {
          email,
          solanaAddress,
          movementAddress,
          userInfo: profile,
        };
        await SecureStore.setItemAsync(
          "banter_pending_registration",
          JSON.stringify(pending)
        );
        router.replace("/(auth)/register");
      }
    } catch (error) {
      setLoginError((error as Error)?.message ?? "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

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
      {initError ? <Text style={styles.errorText}>{initError}</Text> : null}
      {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
      <Pressable
        style={[
          styles.googleButton,
          (isInitializing || !web3auth || loginLoading) &&
            styles.googleButtonDisabled,
        ]}
        onPress={login}
        disabled={isInitializing || !web3auth || loginLoading}
      >
        {isInitializing || loginLoading ? (
          <>
            <ActivityIndicator color="#0d0d0d" />
            <Text style={styles.googleButtonText}>
              {isInitializing ? "Initializing..." : "Signing you in..."}
            </Text>
          </>
        ) : (
          <>
            <FontAwesome name="google" size={18} color="#111" />
            <Text style={styles.googleButtonText}>Sign in with Google</Text>
          </>
        )}
      </Pressable>
      {initError ? (
        <View style={{ marginTop: 10 }}>
          <Pressable
            style={styles.retryButton}
            onPress={() => setInitAttempts((n) => n + 1)}
          >
            <Text style={styles.retryText}>Retry initialization</Text>
          </Pressable>
        </View>
      ) : null}
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
  retryButton: {
    backgroundColor: "#1f1f1f",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  retryText: {
    color: "#ff6b35",
    fontWeight: "700",
  },
});

export default AuthLoginScreen;
