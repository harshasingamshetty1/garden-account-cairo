#!/usr/bin/env node
import { deployBraavosAccount } from "./scripts/deploy";
import { approveHTLCTokens } from "./scripts/approval";
import { setupHTLCSession } from "./scripts/authorize";
import { setupWhitelistSession } from "./scripts/whitelist";
import { addSigner } from "./scripts/add_signer";
import {
  fundAccount,
  provider,
  generateCreds,
  buildDeploymentParams,
} from "./utils";
import { config } from "./config/constants";

async function main() {
  try {
    console.log("📦 Deploying account...");
    const creds = generateCreds();

    const deploymentParams = buildDeploymentParams({
      feeRate: config.deployment.feeRate,
      multisigThreshold: config.deployment.multisigThreshold,
      secpX: 0n,
      secpY: 0n,
      starkFeeRate: config.deployment.starkFeeRate,
      withdrawalLimit: config.deployment.withdrawalLimit,
    });

    const deploymentResult = await deployBraavosAccount({
      creds,
      deploymentParams,
    });

    console.log("💰 Funding account...");
    const fundTxHash = await fundAccount(deploymentResult.address);
    const fundReceipt = await provider.waitForTransaction(fundTxHash, {
      retryInterval: 5000,
    });

    if (!fundReceipt.isSuccess) throw new Error("Funding failed");

    console.log(`✅ Deployed: ${deploymentResult.address}`);

    console.log("\n🔐 Approving HTLC token...");
    await approveHTLCTokens();

    if (
      !config.permissionAddress ||
      config.permissionAddress ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      console.log("\n⚠️  Skipping HTLC session (no permissionAddress set)");
    } else {
      console.log("\n🎯 Setting up HTLC session...");
      await setupHTLCSession({
        sessionOwner: config.permissionAddress,
        executeAfterOffset: config.session.executeAfterOffset,
        executeBeforeDuration: config.session.executeBeforeDuration,
      });
    }

    if (
      !config.whitelistAddress ||
      config.whitelistAddress ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      console.log("\n⚠️  Skipping whitelist session (no whitelistAddress set)");
    } else if (config.whitelistTokenAddresses.length === 0) {
      console.log("\n⚠️  Skipping whitelist session (no tokens configured)");
    } else {
      console.log("\n💎 Setting up whitelist session...");
      await setupWhitelistSession({
        whitelistAddress: config.whitelistAddress,
        executeAfterOffset: config.session.executeAfterOffset,
        executeBeforeDuration: 365 * 24 * 60 * 60,
      });
    }

    console.log("\n✅ Setup complete!");
    console.log(`\nAccount: ${deploymentResult.address}`);

    // console.log("\n🔐 Adding signer...");
    // await addSigner(config.deployment.addSignerMultisigThreshold);
  } catch (error) {
    console.error("\n❌ Setup failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
