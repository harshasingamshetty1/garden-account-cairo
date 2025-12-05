#!/usr/bin/env node
import "dotenv/config";
import { provider, generateCreds, saveCreds } from "../utils";
import { buildDeploymentParams, fundAccount } from "../helpers/deployment";
import { deployBraavosAccount } from "./deploy";
import { config } from "../config/constants";
import { getPublicKeyFromLedger } from "../tests/ledger_signing";

/**
 * Deploy a Braavos account with Ledger as the secp256r1 signer
 */
async function deployWithLedger() {
  try {
    console.log("\n╔═══════════════════════════════════════════════╗");
    console.log("║   Deploy Braavos Account with Ledger Signer   ║");
    console.log("╚═══════════════════════════════════════════════╝\n");

    // Step 1: Get Ledger public key
    console.log("📡 Getting public key from Ledger...\n");
    const ledgerPubKey = await getPublicKeyFromLedger();

    console.log("\n✅ Ledger public key retrieved!");
    console.log(`   X: ${ledgerPubKey.x}`);
    console.log(`   Y: ${ledgerPubKey.y}\n`);

    // Step 2: Generate Stark credentials (for deployment authorization)
    console.log("🔑 Generating Stark credentials for account...");
    const creds = generateCreds();
    console.log("✅ Credentials generated!");
    console.log(`   Address: ${creds.address}`);
    console.log(`   Public Key: ${creds.publicKey}\n`);

    // Step 3: Build deployment params with Ledger as secp256r1 signer
    console.log("🔨 Building deployment parameters...");
    const deploymentParams = buildDeploymentParams({
      feeRate: config.deployment.feeRate,
      multisigThreshold: config.deployment.multisigThreshold,
      secpX: ledgerPubKey.x, // Use Ledger X coordinate
      secpY: ledgerPubKey.y, // Use Ledger Y coordinate
      starkFeeRate: config.deployment.starkFeeRate,
      withdrawalLimit: config.deployment.withdrawalLimit,
    });

    console.log("✅ Deployment parameters built!");
    console.log(
      `   Multisig Threshold: ${config.deployment.multisigThreshold}`,
    );
    console.log(`   Withdrawal Limit: ${config.deployment.withdrawalLimit}`);
    console.log(`   Fee Rate: ${config.deployment.feeRate}`);
    console.log(`   Stark Fee Rate: ${config.deployment.starkFeeRate}\n`);

    // Step 4: Deploy the account
    console.log("🚀 Deploying Braavos account...");
    const deployment = await deployBraavosAccount({
      creds,
      deploymentParams,
    });

    console.log("✅ Account deployed successfully!");
    console.log(`   Address: ${deployment.address}`);
    console.log(`   Transaction: ${deployment.transactionHash}\n`);

    // Step 5: Fund the account
    console.log("💰 Funding account...");
    const fundTxHash = await fundAccount(deployment.address);
    const fundReceipt = await provider.waitForTransaction(fundTxHash, {
      retryInterval: 5000,
    });

    if (!fundReceipt.isSuccess) {
      throw new Error("Funding transaction failed");
    }

    console.log("✅ Funding successful!");
    console.log(`   Transaction: ${fundTxHash}\n`);

    // Step 6: Save deployment info with note about Ledger
    console.log("💾 Saving deployment credentials...");
    saveCreds(creds);

    console.log("\n╔═══════════════════════════════════════════════╗");
    console.log("║              Deployment Complete!              ║");
    console.log("╚═══════════════════════════════════════════════╝\n");

    console.log("📋 Summary:");
    console.log(`   Account Address: ${deployment.address}`);
    console.log(`   Stark Public Key: ${creds.publicKey}`);
    console.log(`   Ledger Signer X: ${ledgerPubKey.x}`);
    console.log(`   Ledger Signer Y: ${ledgerPubKey.y}`);
    console.log(`   Deployment TX: ${deployment.transactionHash}`);
    console.log(`   Funding TX: ${fundTxHash}\n`);

    console.log("⚠️  Important Notes:");
    console.log("   - Your account has a Ledger secp256r1 signer");
    console.log("   - To add more signers, use: npm run add-signer:ledger");
    console.log("   - The Ledger will sign all add_signer transactions\n");
  } catch (error) {
    console.error(
      "\n❌ Deployment failed:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  deployWithLedger();
}
