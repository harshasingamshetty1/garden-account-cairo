#!/usr/bin/env node
/**
 * transfer_multisig_funds.ts
 *
 * Transfers 1 STRK token using multisig (threshold 2) requiring both:
 * - Stark signer (DEPLOYER_PRIVATE_KEY)
 * - Secp256r1 signer (SECP256R1_PRIVATE_KEY)
 *
 * Usage:
 *   npx ts-node script/transfer_multisig_funds.ts <network> <rpc_url>
 *
 * Env required:
 *   BRAAVOS_ACCOUNT_ADDRESS   - Your Braavos account address
 *   DEPLOYER_PRIVATE_KEY      - Stark signer private key
 *   SECP256R1_PRIVATE_KEY     - Secp256r1 signer private key (hex, with or without 0x)
 *   SECP256R1_PUBKEY          - Secp256r1 public key (uncompressed, 0x04 + 128 hex chars)
 *   TARGET_ADDRESS            - Recipient address for the transfer
 *   STARKNET_NODE_URL         - RPC endpoint (optional if passed as arg)
 *
 * Optional:
 *   STRK_TOKEN_ADDRESS        - STRK token address (default: Sepolia STRK)
 */

import { Account, RpcProvider, hash, ec } from "starknet";
import type { Call } from "starknet";
import { createECDH, createSign, createPrivateKey } from "crypto";
import * as path from "path";
import * as dotenv from "dotenv";

// shake256 will be loaded dynamically when needed

// Load .env from script folder
const SCRIPT_DIR = path.resolve(process.cwd(), "script");
dotenv.config({ path: path.join(SCRIPT_DIR, ".env") });
dotenv.config(); // Also load root .env

type NetworkType = "sepolia" | "mainnet" | "devnet";

// SignerType values from src/signers/signer_type.cairo
const STARK_SIGNER_TYPE = 0n;
const SECP256R1_SIGNER_TYPE = 2n;

// STRK token address on Sepolia (default)
const SEPOLIA_STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ONE_STRK = 1000000000000000000n; // 1e18

function splitUint256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;
  return { low, high };
}

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function hexToBigInt(hex: string): bigint {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt("0x" + cleaned);
}

/**
 * Extract x and y coordinates from uncompressed secp256r1 public key
 */
function extractXYFromPubKey(pubKeyHex: string): { x: bigint; y: bigint } {
  const cleaned = pubKeyHex.startsWith("0x") ? pubKeyHex.slice(2) : pubKeyHex;
  const key = cleaned.startsWith("04") ? cleaned.slice(2) : cleaned;
  
  if (key.length !== 128) {
    throw new Error(`Invalid public key length. Expected 128 hex chars, got ${key.length}`);
  }

  const xHex = key.slice(0, 64);
  const yHex = key.slice(64, 128);
  return {
    x: hexToBigInt(xHex),
    y: hexToBigInt(yHex),
  };
}

/**
 * Sign hash with secp256r1 using SHAKE256 (as per Braavos spec)
 */
async function signHashSecp256r1(
  hashValue: bigint,
  privateKeyHex: string,
  pubKey: { x: bigint; y: bigint }
): Promise<{ r: bigint; s: bigint; pubKey: { x: bigint; y: bigint } }> {
  const privKey = Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privKey);

  // Convert hash to bytes
  const hashBytes = Buffer.from(
    hashValue.toString(16).padStart(64, "0"),
    "hex"
  );

  // Hash with SHAKE256 (32 bytes output) as per Braavos spec
  // Note: For proper SHAKE256, install @noble/hashes: npm install @noble/hashes
  let hashed: Uint8Array;
  try {
    const { shake256 } = await import("@noble/hashes/sha3.js");
    // SHAKE256 with 32-byte output (256 bits)
    // shake256 takes (msg, options) where options.dkLen is the output length
    const hashInput = new Uint8Array(hashBytes);
    hashed = shake256(hashInput, { dkLen: 32 });
    
    if (hashed.length !== 32) {
      throw new Error(`SHAKE256 output length mismatch: expected 32, got ${hashed.length}`);
    }
  } catch (e) {
    // Fallback: use SHA256 (not ideal but will work for testing)
    // In production, you MUST use SHAKE256
    console.warn("⚠️  SHAKE256 not available, falling back to SHA256");
    const { createHash } = await import("node:crypto");
    hashed = new Uint8Array(createHash("sha256").update(hashBytes).digest());
    
    if (hashed.length !== 32) {
      throw new Error(`SHA256 output length mismatch: expected 32, got ${hashed.length}`);
    }
  }

  // Sign using secp256r1 with @noble/curves (supports pre-hashed data)
  let r: bigint, s: bigint;
  try {
    // Import p256 from @noble/curves
    // @ts-ignore - @noble/curves/p256 exists at runtime
    const p256Module = await import("@noble/curves/p256");
    const p256 = p256Module.p256;
    
    if (!p256 || typeof p256.sign !== "function") {
      throw new Error("p256.sign is not available");
    }
    
    // Ensure hashed is exactly 32 bytes (Uint8Array)
    if (hashed.length !== 32) {
      throw new Error(`Expected 32-byte hash, got ${hashed.length} bytes`);
    }
    
    // Use the private key directly from the buffer (32 bytes)
    // ecdh.getPrivateKey() should return the raw private key bytes
    const privateKeyBytes = new Uint8Array(privKey);
    
    if (privateKeyBytes.length !== 32) {
      throw new Error(`Expected 32-byte private key, got ${privateKeyBytes.length} bytes`);
    }
    
    // Sign the hash with the private key
    const signature = p256.sign(hashed, privateKeyBytes);
    
    // Extract r and s from signature
    r = signature.r;
    s = signature.s;
  } catch (e) {
    // If @noble/curves fails, provide clear error message
    const errorMsg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to sign with secp256r1 using @noble/curves: ${errorMsg}\n` +
      `Please ensure @noble/curves is properly installed:\n` +
      `  npm install @noble/curves @noble/hashes\n` +
      `If the package is installed, try:\n` +
      `  npm uninstall @noble/curves && npm install @noble/curves@latest`
    );
  }

  return { r, s, pubKey };

}

/**
 * Create a multisig signer that combines Stark and Secp256r1 signatures
 */
function createMultisigSigner(
  starkPrivateKey: string,
  secp256r1PrivateKey: string,
  secp256r1PubKey: { x: bigint; y: bigint },
  provider: RpcProvider,
  accountAddress: string
) {
  return {
    signTransaction: async (tx: any) => {
      // Get chain ID if not provided
      const chainId = tx.chainId || (await provider.getChainId());
      
      // Calculate transaction hash using calculateInvokeTransactionHash
      const txHash = hash.calculateInvokeTransactionHash({
        senderAddress: tx.senderAddress || accountAddress,
        version: tx.version || "0x3",
        chainId,
        nonce: tx.nonce || "0x0",
        nonceDataAvailabilityMode: tx.nonceDataAvailabilityMode ?? 0,
        feeDataAvailabilityMode: tx.feeDataAvailabilityMode ?? 0,
        resourceBounds: tx.resourceBounds || {
          l1_gas: { max_amount: BigInt("0x0"), max_price_per_unit: BigInt("0x0") },
          l2_gas: { max_amount: BigInt("0x0"), max_price_per_unit: BigInt("0x0") },
          l1_data_gas: { max_amount: BigInt("0x0"), max_price_per_unit: BigInt("0x0") },
        },
        tip: tx.tip || "0x0",
        paymasterData: tx.paymasterData || [],
        accountDeploymentData: tx.accountDeploymentData || [],
        compiledCalldata: tx.compiledCalldata || []
    });

      // Sign with Stark signer (txHash is already a Hex string)
      const starkSig = ec.starkCurve.sign(txHash, starkPrivateKey);

      // Sign with Secp256r1 signer (convert to bigint for secp256r1 signing)
      const hashBigInt = BigInt(txHash);
      const secp256r1Sig = await signHashSecp256r1(hashBigInt, secp256r1PrivateKey, secp256r1PubKey);

      // Format signatures according to Braavos multisig format:
      // [STARK_SIGNER_TYPE, r_stark, s_stark, SECP256R1_SIGNER_TYPE, pub_x.low, pub_x.high, pub_y.low, pub_y.high, r_secp.low, r_secp.high, s_secp.low, s_secp.high]
      const { low: xLow, high: xHigh } = splitUint256(secp256r1PubKey.x);
      const { low: yLow, high: yHigh } = splitUint256(secp256r1PubKey.y);
      const { low: rLow, high: rHigh } = splitUint256(secp256r1Sig.r);
      const { low: sLow, high: sHigh } = splitUint256(secp256r1Sig.s);

      return [
        toHex(STARK_SIGNER_TYPE),
        toHex(BigInt(starkSig.r)),
        toHex(BigInt(starkSig.s)),
        toHex(SECP256R1_SIGNER_TYPE),
        toHex(xLow),
        toHex(xHigh),
        toHex(yLow),
        toHex(yHigh),
        toHex(rLow),
        toHex(rHigh),
        toHex(sLow),
        toHex(sHigh),
      ];
    },
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error(
      "Usage: ts-node transfer_multisig_funds.ts <network> [rpc_url]\n" +
        "Env required: BRAAVOS_ACCOUNT_ADDRESS, DEPLOYER_PRIVATE_KEY, " +
        "SECP256R1_PRIVATE_KEY, SECP256R1_PUBKEY, TARGET_ADDRESS"
    );
    process.exit(1);
  }

  const network = args[0] as NetworkType;
  const rpcUrl = args[1] || process.env.STARKNET_NODE_URL;

  if (!["sepolia", "mainnet", "devnet"].includes(network)) {
    console.error("Invalid network. Supported: sepolia, mainnet, devnet");
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error("Missing RPC URL. Provide as arg or set STARKNET_NODE_URL in env");
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const braavosAddress = process.env.BRAAVOS_ACCOUNT_ADDRESS;
  const starkPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const secp256r1PrivateKey = process.env.SECP256R1_PRIVATE_KEY;
  const secp256r1PubKeyHex = process.env.SECP256R1_PUBKEY;
  const targetAddress = process.env.TARGET_ADDRESS;
  const strkTokenAddress = process.env.STRK_TOKEN_ADDRESS || SEPOLIA_STRK_TOKEN;

  if (!braavosAddress || !starkPrivateKey || !secp256r1PrivateKey || !secp256r1PubKeyHex || !targetAddress) {
    console.error(
      "Missing required env vars:\n" +
        "  BRAAVOS_ACCOUNT_ADDRESS\n" +
        "  DEPLOYER_PRIVATE_KEY (Stark signer)\n" +
        "  SECP256R1_PRIVATE_KEY (secp256r1 signer)\n" +
        "  SECP256R1_PUBKEY (uncompressed, 0x04 + 128 hex chars)\n" +
        "  TARGET_ADDRESS (recipient)"
    );
    process.exit(1);
  }

  // Extract secp256r1 public key coordinates
  const secp256r1PubKey = extractXYFromPubKey(secp256r1PubKeyHex);

  // Clean private key (remove 0x if present)
  const cleanSecp256r1Key = secp256r1PrivateKey.replace(/^0x/, "");

  // Create multisig signer
  const multisigSigner = createMultisigSigner(
    starkPrivateKey,
    cleanSecp256r1Key,
    secp256r1PubKey,
    provider,
    braavosAddress
  );

  // Create account with multisig signer
  const account = new Account({
    provider,
    address: braavosAddress,
    signer: multisigSigner as any,
  });

  console.log("💰 Transferring 1 STRK with Multisig (Threshold 2)\n");
  console.log("=== Configuration ===");
  console.log(`Account: ${braavosAddress}`);
  console.log(`Recipient: ${targetAddress}`);
  console.log(`Amount: 1 STRK (${ONE_STRK.toString()})`);
  console.log(`STRK Token: ${strkTokenAddress}`);
  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}\n`);

  // Prepare transfer call
  const { low: amountLow, high: amountHigh } = splitUint256(ONE_STRK);
  const transferCall: Call = {
    contractAddress: strkTokenAddress,
    entrypoint: "transfer",
    calldata: [targetAddress, toHex(amountLow), toHex(amountHigh)],
  };

  console.log("=== Transfer Call ===");
  console.log(`Contract: ${transferCall.contractAddress}`);
  console.log(`Entrypoint: ${transferCall.entrypoint}`);
  console.log(`Calldata:`, transferCall.calldata);
  console.log();

  try {
    // Test RPC connection first
    console.log("🔍 Testing RPC connection...");
    try {
      const chainId = await provider.getChainId();
      const blockNumber = await provider.getBlockNumber();
      console.log(`✅ RPC connected - Chain ID: ${chainId}, Block: ${blockNumber}\n`);
    } catch (rpcErr: any) {
      console.error("❌ RPC connection failed:", rpcErr?.message ?? rpcErr);
      if (rpcErr?.response) {
        console.error("Response:", rpcErr.response);
      }
      throw new Error(`RPC connection failed: ${rpcErr?.message ?? rpcErr}`);
    }

    // Get account nonce to verify account access
    console.log("📊 Fetching account information...");
    try {
      const nonce = await account.getNonce();
      console.log(`   Current nonce: ${nonce}\n`);
    } catch (nonceErr: any) {
      console.warn(`⚠️  Could not fetch nonce: ${nonceErr?.message ?? nonceErr}`);
      console.warn("   Continuing anyway...\n");
    }

    console.log("⏳ Submitting multisig transaction...");
    console.log("   (Requires signatures from both Stark and Secp256r1 signers)\n");

    let transaction_hash: string;
    try {
      const result = await account.execute([transferCall]);
      transaction_hash = result.transaction_hash;
    } catch (executeErr: any) {
      // Enhanced error for execute failures
      const errorMsg = String(executeErr?.message ?? executeErr);
      if (errorMsg.includes("tip statistics") || errorMsg.includes("starting block number")) {
        throw new Error(
          `Fee estimation failed. This usually indicates an RPC issue.\n` +
          `Original error: ${errorMsg}\n` +
          `Please verify:\n` +
          `  1. Your RPC URL is correct and accessible\n` +
          `  2. Your RPC API key is valid (if required)\n` +
          `  3. The RPC endpoint supports the required methods`
        );
      }
      throw executeErr;
    }

    console.log(`✅ Transaction submitted: ${transaction_hash}`);
    console.log("⏳ Waiting for confirmation...\n");

    const receipt = await provider.waitForTransaction(transaction_hash, {
      retryInterval: 5000,
    });

    const success =
      typeof receipt.isSuccess === "function"
        ? receipt.isSuccess()
        : receipt.isSuccess;

    if (!success) {
      throw new Error("Transaction failed");
    }

    console.log(`✅ Transfer successful!`);
    console.log(`\n=== Transaction Details ===`);
    console.log(`Transaction Hash: ${transaction_hash}`);
    console.log(`Status: ${success ? "Success" : "Failed"}`);
    console.log(`\nView on Starkscan: https://sepolia.starkscan.co/tx/${transaction_hash}`);
  } catch (err: any) {
    console.error("\n❌ Failed to transfer:", err?.message ?? err);
    
    // Enhanced error logging
    if (err?.response) {
      console.error("\n=== RPC Response Error ===");
      try {
        console.error("Response:", JSON.stringify(err.response, null, 2));
      } catch {
        console.error("Response (raw):", err.response);
      }
    }
    
    if (err?.cause) {
      console.error("\n=== Error Cause ===");
      console.error(err.cause);
    }
    
    if (err?.stack) {
      console.error("\n=== Stack Trace ===");
      console.error(err.stack);
    }
    
    // Check for common RPC errors
    const errorMsg = String(err?.message ?? err).toLowerCase();
    if (errorMsg.includes("must be") || errorMsg.includes("authentication") || errorMsg.includes("unauthorized")) {
      console.error("\n💡 Tip: Check your RPC URL and API key. The endpoint may require authentication.");
    }
    if (errorMsg.includes("json") || errorMsg.includes("parse")) {
      console.error("\n💡 Tip: The RPC endpoint may be returning an error page instead of JSON. Verify your RPC URL is correct.");
    }
    
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
