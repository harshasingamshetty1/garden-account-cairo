#!/usr/bin/env node
import "dotenv/config";
import path from "path";
import {
  readCreds,
  provider,
  getBravosAccount,
  generateSecp256r1KeyPair,
  formatPublicKey,
  buildAddSignerCall,
  saveSignerInfo,
  loadSignerStorage,
} from "./utils";
import { config } from "./config";

async function addSigner() {
  try {
    const creds = readCreds();
    const account = getBravosAccount(creds);
    console.log(`📍 Braavos Account: ${creds.address}\n`);

    // Generate new signer keypair
    const newSigner = generateSecp256r1KeyPair();
    const { pub_x, pub_y } = formatPublicKey(newSigner.publicKey);

    console.log(`✅ Generated new signer:`);
    console.log(`   Public Key X: ${newSigner.publicKey.x.toString()}`);
    console.log(`   Public Key Y: ${newSigner.publicKey.y.toString()}`);
    console.log(`   X (u256): { low: ${pub_x.low}, high: ${pub_x.high} }`);
    console.log(`   Y (u256): { low: ${pub_y.low}, high: ${pub_y.high} }\n`);

    // Build and submit transaction
    const addSignerCall = buildAddSignerCall(creds.address, newSigner);

    console.log("🚀 Submitting add_signer transaction...");
    console.log("   Multisig threshold: 0 (no multisig requirement)\n");

    const tx = await account.execute(addSignerCall);

    console.log(`✅ Transaction submitted: ${tx.transaction_hash}`);
    console.log("⏳ Waiting for confirmation...\n");

    await provider.waitForTransaction(tx.transaction_hash);

    console.log("✅ Signer added successfully!\n");

    // Save signer info to file
    const signerFilePath = path.join(
      path.dirname(config.credsFile),
      "added_signers.json",
    );

    const storage = loadSignerStorage(signerFilePath);
    saveSignerInfo(signerFilePath, storage, newSigner, tx.transaction_hash);

    console.log(`📄 Signer info saved to: ${signerFilePath}`);
    console.log(`\n✅ New secp256r1 signer added successfully!`);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

addSigner();
