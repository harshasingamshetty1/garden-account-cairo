#!/usr/bin/env node
/**
 * generate_secp256r1_keypair.ts
 *
 * Generates a fresh secp256r1 key pair and prints:
 * - raw private key (hex)
 * - public key (uncompressed hex)
 * - x,y as decimals
 * - u256 splits (low/high) for Braavos calldata/env vars
 *
 * Usage:
 *   npx ts-node script/generate_secp256r1_keypair.ts
 */

import { createECDH } from "crypto";

function hexToBigInt(hex: string): bigint {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt("0x" + cleaned);
}

function splitUint256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;
  return { low, high };
}

function main() {
  const ecdh = createECDH("prime256v1"); // secp256r1
  ecdh.generateKeys();

  const privHex = ecdh.getPrivateKey("hex");
  const pubHexUncompressed = ecdh.getPublicKey("hex", "uncompressed"); // 04 + 64b x + 64b y

  const pubClean = pubHexUncompressed.startsWith("04")
    ? pubHexUncompressed.slice(2)
    : pubHexUncompressed;

  const xHex = pubClean.slice(0, 64);
  const yHex = pubClean.slice(64, 128);

  const x = hexToBigInt(xHex);
  const y = hexToBigInt(yHex);

  const { low: xLow, high: xHigh } = splitUint256(x);
  const { low: yLow, high: yHigh } = splitUint256(y);

  console.log("🔐 Generated secp256r1 keypair\n");
  console.log("Private key (keep secret!):");
  console.log(`  0x${privHex}`);
  console.log("\nPublic key (uncompressed):");
  console.log(`  0x04${pubClean}`);
  console.log("\nCoordinates (decimal):");
  console.log(`  x: ${x.toString()}`);
  console.log(`  y: ${y.toString()}`);
  console.log("\nBraavos calldata/env (u256 split into u128):");
  console.log(`  LEDGER_PUBKEY_X_LOW=${xLow.toString()}`);
  console.log(`  LEDGER_PUBKEY_X_HIGH=${xHigh.toString()}`);
  console.log(`  LEDGER_PUBKEY_Y_LOW=${yLow.toString()}`);
  console.log(`  LEDGER_PUBKEY_Y_HIGH=${yHigh.toString()}`);
  console.log("\nNext steps:");
  console.log("  1) Copy the *_LOW/HIGH values into script/.env");
  console.log("  2) Run: npx ts-node script/add_ledger_signer.ts");
  console.log("  3) Use the private key above only if you need to sign tests; do not share it.");
}

main();

