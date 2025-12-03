#!/usr/bin/env node
import { readJsonFile } from "./helpers/file";
import { hash, ec, TypedData, typedData as typedDataUtils } from "starknet";
import path from "path";
import { config } from "./config";
import { readCreds } from "./utils";

interface SessionInfo {
  sessionHash: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
  }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  signature: string[];
  htlcAddress: string;
  braavosAccount: string;
  createdAt: string;
}

async function verifySignature() {
  console.log("🔍 Verifying Session Signature\n");

  // Load session info
  const sessionFile = path.join(path.dirname(config.credsFile), "session.json");
  const sessionInfo = readJsonFile<SessionInfo>(sessionFile);

  // Load account creds
  const creds = readCreds();

  console.log("📋 Account Info:");
  console.log(`   Address: ${creds.address}`);
  console.log(`   Public Key: ${creds.publicKey}`);
  console.log(`   Private Key: ${creds.privateKey.slice(0, 10)}...`);

  console.log("\n📋 Session Info:");
  console.log(`   Session Hash: ${sessionInfo.sessionHash}`);
  console.log(`   Signature format: [signer_type, r, s]`);
  console.log(
    `   Signer Type: ${sessionInfo.signature[0]} (1=Stark, 2=Secp256r1)`,
  );
  console.log(`   Signature r: ${sessionInfo.signature[1]}`);
  console.log(`   Signature s: ${sessionInfo.signature[2]}`);

  // Verify the public key matches the private key
  const computedPublicKey = ec.starkCurve.getStarkKey(creds.privateKey);
  console.log("\n🔑 Key Verification:");
  console.log(`   Stored Public Key: ${creds.publicKey}`);
  console.log(`   Computed Public Key: ${computedPublicKey}`);
  console.log(
    `   Match: ${creds.publicKey === computedPublicKey ? "✅" : "❌"}`,
  );

  // Try to verify the signature using starknet.js
  try {
    const msgHash = BigInt(sessionInfo.sessionHash);
    // Skip the signer type (index 0) and get actual r and s
    const r = BigInt(sessionInfo.signature[1]);
    const s = BigInt(sessionInfo.signature[2]);
    const pubKey = BigInt(creds.publicKey);

    const isValid = ec.starkCurve.verify(
      { r, s },
      msgHash.toString(16).padStart(64, "0"),
      pubKey.toString(16).padStart(64, "0"),
    );

    console.log("\n✨ Signature Verification:");
    console.log(`   Is Valid: ${isValid ? "✅" : "❌"}`);

    if (!isValid) {
      console.log("\n❌ Signature is INVALID!");
      console.log(
        "   This means either the hash or signature was computed incorrectly.",
      );
    } else {
      console.log("\n✅ Signature is VALID!");
      console.log(
        "   The signature correctly signs the session hash with the account's private key.",
      );
      console.log(
        "   If you're still getting INVALID_SIG, the issue might be:",
      );
      console.log(
        "     1. The account doesn't have this signer registered on-chain",
      );
      console.log(
        "     2. There's a mismatch in how the hash is calculated on-chain vs off-chain",
      );
      console.log(
        "     3. The signature format expected by the contract is different",
      );
    }
  } catch (error) {
    console.error("\n❌ Error verifying signature:", error);
  }
}

verifySignature().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
