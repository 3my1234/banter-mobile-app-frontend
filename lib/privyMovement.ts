import {
  Aptos,
  AptosConfig,
  Network,
  AccountAddress,
  AccountAuthenticatorEd25519,
  Ed25519PublicKey,
  Ed25519Signature,
  generateSigningMessageForTransaction,
} from "@aptos-labs/ts-sdk";
import { Buffer } from "buffer";

type SignRawHashInput = {
  address: string;
  chainType: string;
  hash: `0x${string}`;
};

type SignRawHashOutput = {
  signature: `0x${string}`;
};

export type MovementTransactionData = {
  type: string;
  function: string;
  type_arguments: string[];
  arguments: string[];
};

export function getMovementWallet(privyUser: any) {
  if (!privyUser?.linkedAccounts && !privyUser?.linked_accounts) {
    return null;
  }
  const accounts = privyUser?.linkedAccounts || privyUser?.linked_accounts || [];
  return accounts.find(
    (account: any) =>
      account?.type === "wallet" &&
      (account?.chainType === "aptos" ||
        account?.chain_type === "aptos" ||
        account?.chainType === "movement" ||
        account?.chain_type === "movement")
  );
}

export function getMovementWalletByAddress(privyUser: any, address?: string | null) {
  if (!address) return null;
  if (!privyUser?.linkedAccounts && !privyUser?.linked_accounts) {
    return null;
  }
  const wanted = address.trim().toLowerCase();
  const accounts = privyUser?.linkedAccounts || privyUser?.linked_accounts || [];
  return (
    accounts.find((account: any) => {
      const chain = (account?.chainType || account?.chain_type || "").toLowerCase();
      const isMovementChain = chain === "movement" || chain === "aptos";
      const accountAddress = (account?.address || "").trim().toLowerCase();
      return account?.type === "wallet" && isMovementChain && accountAddress === wanted;
    }) || null
  );
}

export async function sendMovementTransaction(
  transactionData: MovementTransactionData,
  walletAddress: string,
  publicKey: string,
  signRawHash: (input: SignRawHashInput) => Promise<SignRawHashOutput> | Promise<any>
): Promise<string> {
  const movementConfig = new AptosConfig({
    network: Network.CUSTOM,
    fullnode:
      process.env.EXPO_PUBLIC_MOVEMENT_RPC_URL ??
      "https://testnet.movementnetwork.xyz/v1",
  });
  const movement = new Aptos(movementConfig);

  const senderAddress = AccountAddress.from(walletAddress);

  if (!transactionData.function.includes("::") || transactionData.function.split("::").length !== 3) {
    throw new Error(`Invalid function format: ${transactionData.function}`);
  }

  const functionName = transactionData.function as `${string}::${string}::${string}`;
  let finalFunctionName = functionName;
  if (functionName === "0x1::coin::transfer") {
    finalFunctionName = "0x1::aptos_account::transfer_coins";
  }

  const rawTxn = await movement.transaction.build.simple({
    sender: senderAddress,
    data: {
      function: finalFunctionName,
      typeArguments: transactionData.type_arguments,
      functionArguments: transactionData.arguments,
    },
    options: {
      maxGasAmount: 50000,
    },
  });

  const message = generateSigningMessageForTransaction(rawTxn);
  const hexMessage = `0x${Buffer.from(message).toString("hex")}` as `0x${string}`;
  const { signature } = await signRawHash({
    address: walletAddress,
    chainType: "aptos",
    hash: hexMessage,
  });

  let cleanPublicKey = publicKey.replace("0x", "");
  if (cleanPublicKey.length === 66 && cleanPublicKey.startsWith("00")) {
    cleanPublicKey = cleanPublicKey.substring(2);
  }
  if (cleanPublicKey.length !== 64) {
    throw new Error(
      `Invalid public key length: expected 64 hex characters (32 bytes), got ${cleanPublicKey.length}`
    );
  }

  const publicKeyBytes = Buffer.from(cleanPublicKey, "hex");
  const signatureBytes = Buffer.from(signature.replace("0x", ""), "hex");

  const senderAuthenticator = new AccountAuthenticatorEd25519(
    new Ed25519PublicKey(publicKeyBytes),
    new Ed25519Signature(signatureBytes)
  );

  const pendingTxn = await movement.transaction.submit.simple({
    transaction: rawTxn,
    senderAuthenticator,
  });

  const executedTxn = await movement.waitForTransaction({
    transactionHash: pendingTxn.hash,
  });

  return executedTxn.hash;
}
