#!/usr/bin/env node
import "dotenv/config";
import {
  TypedData,
  LedgerSigner231,
  Call,
  V3InvocationsSignerDetails,
  Signature,
} from "starknet";
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import { config } from "../config/constants";
import { splitUint128 } from "../utils";

// Configuration
const CONFIG = {
  accountIndex: 0, // Ledger account index (can handle 2^31 accounts)
  nodeUrl: config.nodeUrl,
  // eip2645application: "LedgerW", // Default wallet application name
};

/**
 * Initialize Ledger Signer
 * Creates a LedgerSigner231 instance for Starknet APP version 2.3.1
 */
async function initializeLedgerSigner(): Promise<LedgerSigner231<any>> {
  console.log("⏳ Connecting to Ledger device...");
  const transport = await TransportNodeHid.create();
  const ledgerSigner = new LedgerSigner231(
    transport,
    CONFIG.accountIndex,
    // CONFIG.eip2645application
  );

  console.log("✅ Ledger connected successfully!\n");
  return ledgerSigner;
}

/**
 * Get Public Key from Ledger using LedgerSigner231
 */
async function getPublicKeyFromLedger(): Promise<{
  fullPubKey: string;
  x: bigint;
  y: bigint;
  formatted: { xLow: bigint; xHigh: bigint; yLow: bigint; yHigh: bigint };
}> {
  console.log("⏳ Requesting public key from Ledger...");

  const ledgerSigner = await initializeLedgerSigner();

  try {
    const fullPubKey = await ledgerSigner.getFullPubKey();
    console.log(`   Full PubKey: ${fullPubKey}`);

    // Get APP version
    const appVersion = await ledgerSigner.getAppVersion();
    console.log(`   Ledger APP Version: ${appVersion}`);

    // Parse the full public key
    // Format: 0x + 02 (parity, 2 chars) + X (64 chars) + Y (64 chars)
    const fullPubKeyHex = fullPubKey.replace("0x", "");
    const xHex = fullPubKeyHex.slice(2, 66); // Skip parity, get X
    const yHex = fullPubKeyHex.slice(66, 130); // Get Y

    const x = BigInt("0x" + xHex);
    const y = BigInt("0x" + yHex);

    console.log("\n📐 Parsed Coordinates:");
    console.log(`   X: 0x${x.toString(16)}`);
    console.log(`   Y: 0x${y.toString(16)}`);

    const [xLow, xHigh] = splitUint128(x);
    const [yLow, yHigh] = splitUint128(y);

    console.log("\n📦 Formatted for Braavos (u128 pairs):");
    console.log(`   X Low:  ${xLow}`);
    console.log(`   X High: ${xHigh}`);
    console.log(`   Y Low:  ${yLow}`);
    console.log(`   Y High: ${yHigh}`);

    return {
      fullPubKey,
      x,
      y,
      formatted: { xLow, xHigh, yLow, yHigh },
    };
  } finally {
    await ledgerSigner.transporter.close();
  }
}

/**
 * Sign a TypedData message (SNIP-12) using Ledger
 */
async function signTypedDataMessage(
  typedData: TypedData,
  accountAddress: string,
): Promise<{
  r: bigint;
  s: bigint;
  rLow: bigint;
  rHigh: bigint;
  sLow: bigint;
  sHigh: bigint;
  signature: Signature;
}> {
  console.log("\n⏳ Signing TypedData with Ledger...");
  console.log("   Please review and confirm on your device");

  const ledgerSigner = await initializeLedgerSigner();

  try {
    // Sign the message using signMessage (SNIP-12)
    const signature = await ledgerSigner.signMessage(typedData, accountAddress);

    // Signature is returned as an array [r, s] or [r, s, v]
    const sigArray = Array.isArray(signature) ? signature : [signature];
    const r = BigInt(sigArray[0].toString());
    const s = BigInt(sigArray[1].toString());

    console.log("\n✅ Signature Generated!");
    console.log(`   R: 0x${r.toString(16)}`);
    console.log(`   S: 0x${s.toString(16)}`);

    const [rLow, rHigh] = splitUint128(r);
    const [sLow, sHigh] = splitUint128(s);

    console.log("\n📦 Signature formatted (u128 pairs):");
    console.log(`   R Low:  ${rLow}`);
    console.log(`   R High: ${rHigh}`);
    console.log(`   S Low:  ${sLow}`);
    console.log(`   S High: ${sHigh}`);

    return {
      r,
      s,
      rLow,
      rHigh,
      sLow,
      sHigh,
      signature,
    };
  } finally {
    await ledgerSigner.transporter.close();
  }
}

/**
 * Sign a transaction using Ledger (V3 transaction)
 */
async function signTransaction(
  calls: Call[],
  txDetails: V3InvocationsSignerDetails,
): Promise<{
  signature: {
    r: bigint;
    s: bigint;
    rLow: bigint;
    rHigh: bigint;
    sLow: bigint;
    sHigh: bigint;
    raw: Signature;
  };
}> {
  console.log("\n⏳ Signing transaction with Ledger...");
  console.log("   Please review and confirm on your device");

  const ledgerSigner = await initializeLedgerSigner();

  try {
    // Sign the transaction using signTransaction
    const signature = await ledgerSigner.signTransaction(calls, txDetails);

    // Signature is returned as an array [r, s] or [r, s, v]
    const sigArray = Array.isArray(signature) ? signature : [signature];
    const r = BigInt(sigArray[0].toString());
    const s = BigInt(sigArray[1].toString());

    console.log("\n✅ Transaction Signed!");
    console.log(`   R: 0x${r.toString(16)}`);
    console.log(`   S: 0x${s.toString(16)}`);

    const [rLow, rHigh] = splitUint128(r);
    const [sLow, sHigh] = splitUint128(s);

    return {
      signature: {
        r,
        s,
        rLow,
        rHigh,
        sLow,
        sHigh,
        raw: signature,
      },
    };
  } finally {
    await ledgerSigner.transporter.close();
  }
}

/**
 * Example: Get public key and prepare for add signer
 */
async function demoGetPublicKey() {
  console.log("\n=== Get Public Key from Ledger ===\n");

  const pubKeyData = await getPublicKeyFromLedger();

  console.log("\n📄 Complete Public Key Data:");
  console.log(JSON.stringify(pubKeyData, null, 2));

  return pubKeyData;
}

export { getPublicKeyFromLedger, demoGetPublicKey };

/**
 * Example: Sign a simple typed data message
 */
async function demoSignMessage(accountAddress: string) {
  console.log("\n=== Sign TypedData Message ===\n");

  // Example TypedData message (SNIP-12 format)
  const typedData: TypedData = {
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      Message: [{ name: "message", type: "felt" }],
    },
    primaryType: "Message",
    domain: {
      name: "MyApp",
      version: "1",
      chainId: config.chainId,
    },
    message: {
      message: "Hello from Ledger!",
    },
  };

  console.log("📝 TypedData to sign:");
  console.log(JSON.stringify(typedData, null, 2));

  const signature = await signTypedDataMessage(typedData, accountAddress);

  return { typedData, signature };
}

/**
 * Example: Sign a V3 transaction
 */
async function demoSignTransaction(accountAddress: string) {
  console.log("\n=== Sign V3 Transaction ===\n");

  // Example calls (transfer ETH)
  const calls: Call[] = [
    {
      contractAddress:
        "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      entrypoint: "transfer",
      calldata: [
        "0x11f5fc2a92ac03434a7937fe982f5e5293b65ad438a989c5b78fb8f04a12016",
        "0x9184e72a000",
        "0x0",
      ],
    },
  ];

  // V3 transaction details
  const txDetailsV3: V3InvocationsSignerDetails = {
    chainId: config.chainId as any, // Cast to any to handle string chain IDs
    nonce: "28",
    accountDeploymentData: [],
    paymasterData: [],
    cairoVersion: "1",
    feeDataAvailabilityMode: "L1",
    nonceDataAvailabilityMode: "L1",
    resourceBounds: {
      l1_gas: {
        max_amount: BigInt(0x2a00),
        max_price_per_unit: BigInt(0x5c00000),
      },
      l2_gas: { max_amount: BigInt(0x00), max_price_per_unit: BigInt(0x00) },
      l1_data_gas: {
        max_amount: BigInt(0x00),
        max_price_per_unit: BigInt(0x00),
      },
    },
    tip: BigInt(0),
    version: "0x3",
    walletAddress: accountAddress,
  };

  console.log("📝 Transaction details:");
  console.log(JSON.stringify({ calls, txDetailsV3 }, null, 2));

  const result = await signTransaction(calls, txDetailsV3);

  return result;
}

async function main() {
  try {
    await demoGetPublicKey();

    // await demoSignMessage(accountAddress);

    // await demoSignTransaction(accountAddress);

    console.log("\n✨ All operations completed successfully!\n");
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
