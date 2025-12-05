#!/usr/bin/env node
import "dotenv/config";
import path from "path";
import {
  readCreds,
  provider,
  generateSecp256r1KeyPair,
  saveSignerInfo,
  loadSignerStorage,
} from "../utils";
import { buildAddSignerCall } from "../helpers/calls";
import { config } from "../config/constants";
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import { LedgerSigner231, Account } from "starknet";

export async function addSignerWithLedger(multisigThreshold: bigint) {
  let transport: any;

  try {
    const newSigner = generateSecp256r1KeyPair();
    console.log("✅ New signer generated!");
    console.log(`   X: 0x${newSigner.publicKey.x.toString(16)}`);
    console.log(`   Y: 0x${newSigner.publicKey.y.toString(16)}\n`);

    transport = await TransportNodeHid.create();
    const ledgerSigner = new LedgerSigner231(transport, 0, "LedgerW");

    const creds = readCreds();
    console.log("📋 Account Details:");
    console.log(`   Address: ${creds.address}\n`);

    const account = new Account({
      provider: provider,
      address: creds.address,
      signer: ledgerSigner,
    });

    console.log("🔨 Building add signer transaction...");
    const addSignerCall = buildAddSignerCall(
      creds.address,
      newSigner,
      multisigThreshold,
    );

    const nonce = await account.getNonce();
    console.log(`   Nonce: ${nonce}`);

    const tx = await account.execute([addSignerCall]);
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`📤 Transaction submitted: ${tx.transaction_hash}`);

    const signerFilePath = path.join(
      path.dirname(config.credsFile),
      "added_signers.json",
    );
    const storage = loadSignerStorage(signerFilePath);

    saveSignerInfo(signerFilePath, storage, newSigner, tx.transaction_hash);

    console.log("\n✅ New signer added successfully!");
    console.log(`   Transaction: ${tx.transaction_hash}`);
  } catch (error) {
    console.error(
      "\n❌ Add signer failed:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  } finally {
    if (transport) {
      await transport.close();
    }
  }
}

if (require.main === module) {
  const threshold = BigInt("0");

  addSignerWithLedger(threshold);
}
