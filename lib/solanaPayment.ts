import Web3Auth from "@web3auth/react-native-sdk";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/base";
import { SolanaPrivateKeyProvider } from "@web3auth/solana-provider";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Buffer } from "buffer";

const WEB3AUTH_CLIENT_ID =
  process.env.EXPO_PUBLIC_WEB3AUTH_CLIENT_ID ??
  "REPLACE_ME_WEB3AUTH_CLIENT_ID";
const WEB3AUTH_VERIFIER =
  process.env.EXPO_PUBLIC_WEB3AUTH_VERIFIER ?? "banter-app";
const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
  "228247426621-vgpr7j31fsl6na1ugjlhj2c9cmb7b2vh.apps.googleusercontent.com";
const REDIRECT_URL =
  process.env.EXPO_PUBLIC_WEB3AUTH_REDIRECT_URL ?? "banterv3://login";

const SOLANA_RPC_URL =
  process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const CHAIN_CONFIG = {
  chainNamespace: CHAIN_NAMESPACES.SOLANA,
  chainId: "0x1",
  rpcTarget: SOLANA_RPC_URL,
  displayName: "Solana Mainnet",
  blockExplorer: "https://explorer.solana.com",
  ticker: "SOL",
  tickerName: "Solana",
};

let web3auth: Web3Auth | null = null;

async function getWeb3AuthInstance(): Promise<Web3Auth> {
  if (web3auth) return web3auth;

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
      },
    },
    privateKeyProvider,
  });

  await instance.init();
  web3auth = instance;
  return instance;
}

function normalizePrivateKeyHex(pk: string): string {
  let key = pk.trim();
  if (key.startsWith("0x")) key = key.slice(2);

  const isHex = /^[0-9a-fA-F]+$/.test(key);
  if (isHex) {
    if (key.length < 64) {
      throw new Error("Private key hex too short");
    }
    if (key.length > 64) {
      key = key.slice(-64);
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
}

async function getSolanaKeypair(): Promise<Keypair> {
  const instance = await getWeb3AuthInstance();
  if (!instance.provider) {
    await instance.login({ loginProvider: "google" });
  }

  if (!instance.provider) {
    throw new Error("Wallet not available. Please log in again.");
  }

  const privateKeyHex = await instance.provider.request({
    method: "private_key",
  });
  const normalized = normalizePrivateKeyHex(privateKeyHex as string);
  const seed = Buffer.from(normalized, "hex");
  return Keypair.fromSeed(seed);
}

export async function sendUsdcPayment({
  toAddress,
  tokenMint,
  amountRaw,
  decimals = 6,
}: {
  toAddress: string;
  tokenMint: string;
  amountRaw: string;
  decimals?: number;
}): Promise<string> {
  const keypair = await getSolanaKeypair();
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");

  const mint = new PublicKey(tokenMint);
  const from = keypair.publicKey;
  const to = new PublicKey(toAddress);

  const fromAta = await getAssociatedTokenAddress(mint, from);
  const toAta = await getAssociatedTokenAddress(mint, to);

  const instructions = [];
  const toAtaInfo = await connection.getAccountInfo(toAta);
  if (!toAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(from, toAta, to, mint)
    );
  }

  const amount = BigInt(amountRaw);
  instructions.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      from,
      amount,
      decimals
    )
  );

  const latest = await connection.getLatestBlockhash("finalized");
  const tx = new Transaction();
  tx.feePayer = from;
  tx.recentBlockhash = latest.blockhash;
  instructions.forEach((ix) => tx.add(ix));

  tx.sign(keypair);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );

  return signature;
}
