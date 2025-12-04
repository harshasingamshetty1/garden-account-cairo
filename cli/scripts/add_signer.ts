#!/usr/bin/env node
import "dotenv/config";
import path from "path";
import {
  readCreds,
  provider,
  getBravosAccount,
  generateSecp256r1KeyPair,
  saveSignerInfo,
  loadSignerStorage,
} from "../utils";
import { buildAddSignerCall } from "../helpers/calls";
import { config } from "../config/constants";

export async function addSigner(multisigThreshold: bigint) {
  try {
    const creds = readCreds();
    const account = getBravosAccount(creds);

    const threshold = multisigThreshold;
    const newSigner = generateSecp256r1KeyPair();
    const addSignerCall = buildAddSignerCall(
      creds.address,
      newSigner,
      threshold,
    );
    const tx = await account.execute(addSignerCall);

    await provider.waitForTransaction(tx.transaction_hash);

    const signerFilePath = path.join(
      path.dirname(config.credsFile),
      "added_signers.json",
    );
    const storage = loadSignerStorage(signerFilePath);
    saveSignerInfo(signerFilePath, storage, newSigner, tx.transaction_hash);

    console.log("✅ Signer added");
  } catch (error) {
    console.error(
      "❌ Add signer failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  addSigner(BigInt(0));
}
