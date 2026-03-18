import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { EmbeddedSolanaWalletState } from "@privy-io/expo";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

type EmbeddedSolanaTransferInput = {
  walletState: EmbeddedSolanaWalletState;
  toAddress: string;
  amount: number;
  tokenMint: string;
  decimals?: number;
  memo?: string | null;
  rpcUrl?: string;
};

const resolveSolanaProvider = async (walletState: EmbeddedSolanaWalletState) => {
  const wallet = walletState?.wallets?.[0];
  if (!wallet) {
    throw new Error("Solana wallet not connected. Please sign in again.");
  }
  const provider = await wallet.getProvider();
  return { provider, address: wallet.address };
};

const buildRpcCandidates = (input?: string) => {
  const fromEnv =
    process.env.EXPO_PUBLIC_SOLANA_RPC_URLS ||
    process.env.EXPO_PUBLIC_SOLANA_RPC_URL ||
    "";
  const candidates = [
    input,
    ...fromEnv.split(","),
    "https://rpc.ankr.com/solana",
    "https://api.mainnet-beta.solana.com",
  ]
    .map((url) => (url || "").trim())
    .filter((url) => url.length > 0);
  return Array.from(new Set(candidates));
};

const isNetworkError = (error: unknown) => {
  const message = (error as Error)?.message || "";
  const lower = message.toLowerCase();
  return (
    lower.includes("network request failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("unable to resolve host") ||
    lower.includes("403") ||
    lower.includes("api key") ||
    lower.includes("not allowed")
  );
};

const MIN_SOL_FEE_LAMPORTS = 5000;

const resolveDestinationTokenAccount = async (params: {
  connection: Connection;
  owner: PublicKey;
  mint: PublicKey;
  payer: PublicKey;
}) => {
  const { connection, owner, mint, payer } = params;
  const ownerInfo = await connection.getAccountInfo(owner);
  const isTokenAccount = !!ownerInfo && ownerInfo.owner.equals(TOKEN_PROGRAM_ID);
  if (isTokenAccount) {
    return { tokenAccount: owner, createInstruction: null };
  }

  const ata = await getAssociatedTokenAddress(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const ataInfo = await connection.getAccountInfo(ata);
  if (ataInfo) {
    return { tokenAccount: ata, createInstruction: null };
  }

  const createInstruction = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return { tokenAccount: ata, createInstruction };
};

export const sendEmbeddedSolanaUsdc = async (input: EmbeddedSolanaTransferInput) => {
  const decimals = typeof input.decimals === "number" ? input.decimals : 6;

  const { provider, address } = await resolveSolanaProvider(input.walletState);
  const sender = new PublicKey(address);
  const receiver = new PublicKey(input.toAddress);
  const mint = new PublicKey(input.tokenMint);

  const rpcUrls = buildRpcCandidates(input.rpcUrl);
  let lastError: unknown = null;

  for (const rpcUrl of rpcUrls) {
    const connection = new Connection(rpcUrl, "confirmed");
    try {
      const solBalance = await connection.getBalance(sender, "confirmed");
      if (solBalance < MIN_SOL_FEE_LAMPORTS) {
        throw new Error("Your in-app wallet needs a little SOL for network fees.");
      }
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(sender, { mint });
      if (!tokenAccounts.value.length) {
        throw new Error("No USDC token account found. Receive USDC (Solana) into your in-app wallet first.");
      }
      const sortedAccounts = tokenAccounts.value
        .map((entry) => {
          const amountRaw = BigInt(
            entry.account?.data?.parsed?.info?.tokenAmount?.amount || "0"
          );
          return { pubkey: entry.pubkey, amountRaw };
        })
        .sort((a, b) => (a.amountRaw > b.amountRaw ? -1 : a.amountRaw < b.amountRaw ? 1 : 0));
      const senderTokenAccount = sortedAccounts[0]?.pubkey;
      const senderBalance = sortedAccounts[0]?.amountRaw ?? BigInt(0);
      if (!senderTokenAccount || senderBalance === BigInt(0)) {
        throw new Error("Your in-app wallet has no USDC balance to send.");
      }
      const receiverToken = await resolveDestinationTokenAccount({
        connection,
        owner: receiver,
        mint,
        payer: sender,
      });

      const rawAmount = BigInt(Math.round(input.amount * 10 ** decimals));
      if (senderBalance < rawAmount) {
        throw new Error("Insufficient USDC balance in your in-app wallet.");
      }

      const instructions: TransactionInstruction[] = [];
      if (receiverToken.createInstruction) {
        instructions.push(receiverToken.createInstruction);
      }
      instructions.push(
        createTransferCheckedInstruction(
          senderTokenAccount,
          mint,
          receiverToken.tokenAccount,
          sender,
          rawAmount,
          decimals
        )
      );
      if (input.memo) {
        instructions.push(
          new TransactionInstruction({
            programId: new PublicKey(MEMO_PROGRAM_ID),
            keys: [],
            data: Buffer.from(String(input.memo), "utf8"),
          })
        );
      }

      const transaction = new Transaction().add(...instructions);
      transaction.feePayer = sender;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;

      const result = await provider.request({
        method: "signAndSendTransaction",
        params: {
          transaction,
          connection,
          options: { preflightCommitment: "confirmed" },
        },
      });

      const signature = (result as any)?.signature as string | undefined;
      if (!signature) {
        throw new Error("Failed to broadcast Solana transaction.");
      }

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      return { signature, fromAddress: address };
    } catch (error) {
      lastError = error;
      if (isNetworkError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Network request failed. Please try again.");
};
