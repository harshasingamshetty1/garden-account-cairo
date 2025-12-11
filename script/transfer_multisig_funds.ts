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
const STARK_SIGNER_TYPE = 1n;
const SECP256R1_SIGNER_TYPE = 2n;

// STRK token address on Sepolia (default)
const SEPOLIA_STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ONE_STRK = 1000000000000000000n; // 1e18

function splitUint256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;

  // Debug output
  console.log(`  splitUint256(${value.toString()})`);
  console.log(`    low:  ${low.toString()} (0x${low.toString(16)})`);
  console.log(`    high: ${high.toString()} (0x${high.toString(16)})`);

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
 * Input format: 0x04 + 64 hex chars (x) + 64 hex chars (y) = 130 chars total
 */
function extractXYFromPubKey(pubKeyHex: string): { x: bigint; y: bigint } {
  // Remove 0x prefix if present
  let cleaned = pubKeyHex.startsWith("0x") ? pubKeyHex.slice(2) : pubKeyHex;

  // Remove leading 04 if present (uncompressed marker)
  if (cleaned.startsWith("04")) {
    cleaned = cleaned.slice(2);
  }

  // Should now be 128 hex chars (64 for x, 64 for y)
  if (cleaned.length !== 128) {
    throw new Error(
      `Invalid secp256r1 pubkey format. Expected 128 hex chars (64 x + 64 y), got ${cleaned.length}. ` +
      `Full string: 0x${cleaned}`
    );
  }

  // Split into x and y (32 bytes each = 64 hex chars each)
  const xHex = cleaned.slice(0, 64);
  const yHex = cleaned.slice(64, 128);

  const x = BigInt("0x" + xHex);
  const y = BigInt("0x" + yHex);

  console.log(`\n=== Extracted secp256r1 coordinates ===`);
  console.log(`x (hex): 0x${xHex}`);
  console.log(`x (dec): ${x.toString()}`);
  console.log(`y (hex): 0x${yHex}`);
  console.log(`y (dec): ${y.toString()}\n`);

  return { x, y };
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

  // Sign using secp256r1 package (simpler and more reliable)
  let r: bigint, s: bigint;
  try {
    // Dynamic import for secp256r1 (CommonJS module)
    // @ts-ignore - secp256r1 may not have TypeScript definitions
    const secp256r1 = await import("secp256r1");
    
    // Ensure hashed is exactly 32 bytes (Buffer)
    if (hashed.length !== 32) {
      throw new Error(`Expected 32-byte hash, got ${hashed.length} bytes`);
    }
    
    // Ensure private key is exactly 32 bytes
    if (privKey.length !== 32) {
      throw new Error(`Expected 32-byte private key, got ${privKey.length} bytes`);
    }
    
    // Convert hashed Uint8Array to Buffer for secp256r1
    const hashBuffer = Buffer.from(hashed);
    
    // Sign the hash with the private key using secp256r1
    // secp256r1.sign returns { signature: Buffer (64 bytes), recovery: number }
    // The signature buffer contains: first 32 bytes = r, last 32 bytes = s
    const signatureResult = secp256r1.default ? secp256r1.default.sign(hashBuffer, privKey) : secp256r1.sign(hashBuffer, privKey);
    
    if (!signatureResult || !signatureResult.signature || signatureResult.signature.length !== 64) {
      throw new Error(`Invalid signature from secp256r1: expected 64 bytes, got ${signatureResult?.signature?.length ?? 0}`);
    }
    
    // Extract r and s from the 64-byte signature buffer
    const rBuffer = signatureResult.signature.slice(0, 32);
    const sBuffer = signatureResult.signature.slice(32, 64);
    
    // Convert to bigint
    r = BigInt("0x" + rBuffer.toString("hex"));
    s = BigInt("0x" + sBuffer.toString("hex"));
  } catch (e) {
    // If secp256r1 fails, provide clear error message
    const errorMsg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to sign with secp256r1: ${errorMsg}\n` +
      `Please ensure secp256r1 is properly installed:\n` +
      `  npm install secp256r1\n` +
      `If the package is installed, verify it's compatible with your Node.js version.`
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

      console.log(`\n=== Transaction Hash ===`);
      console.log(`${txHash}\n`);

      // ========== Sign with Stark Signer ==========
      const starkSig = ec.starkCurve.sign(txHash, starkPrivateKey);
      const starkR = BigInt(starkSig.r);
      const starkS = BigInt(starkSig.s);
      
      console.log(`=== Stark Signature ===`);
      console.log(`r: ${starkR.toString()}`);
      console.log(`s: ${starkS.toString()}\n`);

      // ========== Sign with Secp256r1 Signer ==========
      const hashBigInt = BigInt(txHash);
      const secp256r1Sig = await signHashSecp256r1(hashBigInt, secp256r1PrivateKey, secp256r1PubKey);
      
      console.log(`=== Secp256r1 Signature ===`);
      console.log(`r: ${secp256r1Sig.r.toString()}`);
      console.log(`s: ${secp256r1Sig.s.toString()}`);
      console.log(`pub_x: ${secp256r1PubKey.x.toString()}`);
      console.log(`pub_y: ${secp256r1PubKey.y.toString()}\n`);

      // ========== Format Multisig Signature ==========
      // Order matters! Cairo contract expects this exact order:
      // [signer_type_1, stark_r, stark_s, signer_type_2, secp_x_low, secp_x_high, secp_y_low, secp_y_high, secp_r_low, secp_r_high, secp_s_low, secp_s_high]
      
      console.log(`=== Splitting secp256r1 components into u128 ===`);
      console.log(`pub_x: ${secp256r1PubKey.x.toString()}`);
      const { low: xLow, high: xHigh } = splitUint256(secp256r1PubKey.x);
      console.log(`pub_y: ${secp256r1PubKey.y.toString()}`);
      const { low: yLow, high: yHigh } = splitUint256(secp256r1PubKey.y);
      console.log(`sig_r: ${secp256r1Sig.r.toString()}`);
      const { low: rLow, high: rHigh } = splitUint256(secp256r1Sig.r);
      console.log(`sig_s: ${secp256r1Sig.s.toString()}`);
      const { low: sLow, high: sHigh } = splitUint256(secp256r1Sig.s);

      // Build signature array as felt252 values
      const signatureArray = [
        STARK_SIGNER_TYPE.toString(),        // [0] Signer type: Stark = 0
        starkR.toString(),                    // [1] Stark r
        starkS.toString(),                    // [2] Stark s
        SECP256R1_SIGNER_TYPE.toString(),    // [3] Signer type: Secp256r1 = 2
        xLow.toString(),                      // [4] Secp256r1 pub_x low
        xHigh.toString(),                     // [5] Secp256r1 pub_x high
        yLow.toString(),                      // [6] Secp256r1 pub_y low
        yHigh.toString(),                     // [7] Secp256r1 pub_y high
        rLow.toString(),                      // [8] Secp256r1 sig r low
        rHigh.toString(),                     // [9] Secp256r1 sig r high
        sLow.toString(),                      // [10] Secp256r1 sig s low
        sHigh.toString(),                     // [11] Secp256r1 sig s high
      ];

//       const signatureArray = [
//   SECP256R1_SIGNER_TYPE.toString(), // [0] strong signer type
//   xLow.toString(),                  // [1] secp_x_low
//   xHigh.toString(),                 // [2] secp_x_high
//   yLow.toString(),                  // [3] secp_y_low
//   yHigh.toString(),                 // [4] secp_y_high
//   rLow.toString(),                  // [5] secp_r_low
//   rHigh.toString(),                 // [6] secp_r_high
//   sLow.toString(),                  // [7] secp_s_low
//   sHigh.toString(),                 // [8] secp_s_high
//   STARK_SIGNER_TYPE.toString(),     // [9] stark signer type
//   starkR.toString(),                // [10] stark r
//   starkS.toString(),                // [11] stark s
// ];

      console.log(`\n=== Signature Array (length: ${signatureArray.length}) ===`);
      console.log(`[0] STARK_SIGNER_TYPE: ${signatureArray[0]}`);
      console.log(`[1] stark_r: ${signatureArray[1]}`);
      console.log(`[2] stark_s: ${signatureArray[2]}`);
      console.log(`[3] SECP256R1_SIGNER_TYPE: ${signatureArray[3]}`);
      console.log(`[4] secp_x_low: ${signatureArray[4]}`);
      console.log(`[5] secp_x_high: ${signatureArray[5]}`);
      console.log(`[6] secp_y_low: ${signatureArray[6]}`);
      console.log(`[7] secp_y_high: ${signatureArray[7]}`);
      console.log(`[8] secp_r_low: ${signatureArray[8]}`);
      console.log(`[9] secp_r_high: ${signatureArray[9]}`);
      console.log(`[10] secp_s_low: ${signatureArray[10]}`);
      console.log(`[11] secp_s_high: ${signatureArray[11]}\n`);

      // Return as hex-encoded strings (Starknet RPC expects felt252 as hex or decimal strings)
      const hexSig = signatureArray.map(val => {
        const bigVal = BigInt(val);
        // Keep as hex for clarity
        return "0x" + bigVal.toString(16);
      });

      console.log(`=== Hex Format (What RPC receives) ===`);
      hexSig.forEach((h, idx) => {
        console.log(`[${idx}] ${h}`);
      });
      console.log();

      return hexSig;
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
  const strkTokenAddress = process.env.TARGET_CONTRACT || SEPOLIA_STRK_TOKEN;

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

  // Validate SECP256R1 key format
  if (cleanSecp256r1Key.length !== 64) {
    throw new Error(`Invalid SECP256R1_PRIVATE_KEY length. Expected 64 hex chars, got ${cleanSecp256r1Key.length}`);
  }

  // Validate public key format
  const cleanedPubKey = secp256r1PubKeyHex.startsWith("0x") ? secp256r1PubKeyHex.slice(2) : secp256r1PubKeyHex;
  if (cleanedPubKey.startsWith("04") ? cleanedPubKey.length !== 130 : cleanedPubKey.length !== 128) {
    throw new Error(`Invalid SECP256R1_PUBKEY format. Expected 0x04 + 128 hex chars or 128 hex chars, got ${cleanedPubKey.length}`);
  }

  // Derive public key from the provided private key and ensure it matches the supplied pubkey
  try {
    // @ts-ignore - secp256r1 may not ship TypeScript types
    const secpModule = await import("secp256r1");
    const secp = secpModule.default ?? secpModule;
    const privBytes = Buffer.from(cleanSecp256r1Key, "hex");
    const derivedPub = secp.publicKeyCreate(privBytes, false); // uncompressed (65 bytes, starts with 0x04)
    const derivedPubHex = "0x" + derivedPub.toString("hex");
    const normalizedProvided = secp256r1PubKeyHex.toLowerCase();

    if (derivedPubHex.toLowerCase() !== normalizedProvided) {
      throw new Error(
        `SECP256R1 key mismatch!\n` +
        `  Derived from private key: ${derivedPubHex}\n` +
        `  Provided in env:          ${normalizedProvided}`
      );
    }
    console.log(`✅ SECP256R1 private key matches public key\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("SECP256R1 key mismatch")) {
      throw e; // Re-throw our custom error
    }
    throw new Error(`Failed to derive/verify SECP256R1 pubkey: ${msg}`);
  }

  console.log("=== Signers Configuration ===");
  console.log(`Stark Signer (DEPLOYER): ${starkPrivateKey.slice(0, 10)}...${starkPrivateKey.slice(-8)}`);
  console.log(`SECP256R1 Private Key: ${secp256r1PrivateKey.slice(0, 10)}...${secp256r1PrivateKey.slice(-8)}`);
  console.log(`SECP256R1 Public Key: ${secp256r1PubKeyHex.slice(0, 20)}...${secp256r1PubKeyHex.slice(-20)}`);
  console.log(`SECP256R1 PubKey (x, y): (${secp256r1PubKey.x.toString()}, ${secp256r1PubKey.y.toString()})`);
  console.log(`Multisig Threshold: 2 (both signers required)\n`);

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

    // Estimate fee and apply aggressive buffer to avoid out-of-gas in validate
    const feeEstimate = await account.estimateInvokeFee([transferCall]);
    const gasConsumed = BigInt(feeEstimate.gas_consumed ?? 0n);
    const gasPrice = BigInt(feeEstimate.gas_price ?? 0n);
    // Apply 50% buffer + enforce minimum 500k gas for multisig validation
    const bufferedGas = ((gasConsumed * 15n) / 10n) > BigInt(500000) 
      ? (gasConsumed * 15n) / 10n 
      : BigInt(500000);

    const resourceBounds = {
      l2_gas: {
        max_amount: "0x" + bufferedGas.toString(16),
        max_price_per_unit: "0x" + gasPrice.toString(16),
      },
      l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
      l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    } as const;

    console.log("⚙️ Resource bounds (with buffer):", resourceBounds);
    console.log("⏳ Submitting multisig transaction...");
    console.log("   (Requires signatures from both Stark and Secp256r1 signers)\n");

    let transaction_hash: string;
    try {
      const result = await account.execute([transferCall], undefined, { resourceBounds });
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
