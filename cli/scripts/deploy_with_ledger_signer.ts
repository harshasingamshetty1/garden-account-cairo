import * as TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { LedgerSigner231, hash, CallData, Signature, WeierstrassSignatureType } from "starknet";
import { FACTORY_ADDRESS, BASE_CLASS_HASH } from "../config/constants";
import { deployer, provider, saveCreds, buildDeploymentParams, fundAccount } from "../utils";
import { buildFactoryCalldata } from "../helpers/calls";

// Hardcoded public key for Ledger-based deployment
const LEDGER_PUBLIC_KEY = "0x031d478514c8dd57aa2b545e438cd69f49900d15c49794271b1ea59965cca623";

/**
 * Generate account info using the hardcoded Ledger public key
 * Similar to generateCreds() but uses a fixed public key
 */
function generateAccountInfoFromLedgerPubKey() {
  const publicKey = LEDGER_PUBLIC_KEY;
  const salt = publicKey;
  const constructorCalldata = [publicKey];
  const address = hash.calculateContractAddressFromHash(
    salt,
    BASE_CLASS_HASH,
    constructorCalldata,
    0,
  );

  return {
    publicKey,
    salt,
    constructorCalldata,
    address,
    privateKey: "", // Not needed with Ledger
  };
}

/**
 * Sign deployment parameters using Ledger device
 * Signs the raw Poseidon hash directly (same as ec.starkCurve.sign)
 */
async function signAuxParamsWithLedger(
  params: bigint[],
  ledgerSigner: LedgerSigner231,
  accountAddress: string
) {
  // Normalize all params to felt strings (same as original signAuxParams)
  const normalized = params.map((value) => value.toString());
  const payloadHash = hash.computePoseidonHashOnElements(normalized);
  
  console.log("🔐 Signing deployment parameters with Ledger...");
  console.log(`   Payload Hash: ${payloadHash}`);
  
  // Sign the raw hash using Ledger (equivalent to ec.starkCurve.sign)
  const signature = await ledgerSigner.signRaw(payloadHash);
  
  console.log("✅ Raw signature obtained from Ledger");
  console.log(`   Signature array:`, signature);
  
  return {
    r: (signature.r),
    s: (signature.s),
  };
}

async function main() {
  console.log("🚀 Starting Braavos Account Deployment with Ledger Signer\n");

  // Step 1: Generate account info from hardcoded public key
  console.log("📋 Generating account information...");
  const accountInfo = generateAccountInfoFromLedgerPubKey();
  console.log(`   Public Key: ${accountInfo.publicKey}`);
  console.log(`   Address: ${accountInfo.address}`);
  console.log(`   Salt: ${accountInfo.salt}`);

  // Step 2: Build deployment parameters
  console.log("\n🔧 Building deployment parameters...");
  const deploymentParams = buildDeploymentParams({
    feeRate: 0n,
    multisigThreshold: 0n,
    secpX: 0n,
    secpY: 0n,
    starkFeeRate: 0n,
    withdrawalLimit: 0n,
  });
  console.log(`   Parameters count: ${deploymentParams.length}`);

  // Step 3: Connect to Ledger
  console.log("\n🔌 Connecting to Ledger device...");
  const transport = await TransportNodeHid.default.create();
  if (!transport) {
    throw new Error("Failed to connect to Ledger device");
  }
  console.log("✅ Ledger connected");

  const ledgerSigner = new LedgerSigner231(transport, 0); // derivation path index 0

  // Step 4: Verify public key matches
  console.log("\n🔑 Verifying Ledger public key...");
  const ledgerPubKey = await ledgerSigner.getPubKey();
  console.log(`   Ledger Public Key: ${ledgerPubKey}`);
  console.log(`   Expected Public Key: ${LEDGER_PUBLIC_KEY}`);
  
  if (ledgerPubKey !== LEDGER_PUBLIC_KEY) {
    await transport.close();
    throw new Error(
      `Public key mismatch!\n` +
      `  Expected: ${LEDGER_PUBLIC_KEY}\n` +
      `  Got: ${ledgerPubKey}\n` +
      `  Please check your Ledger derivation path.`
    );
  }
  console.log("✅ Public key verified");

  // Step 5: Sign deployment parameters with Ledger
  console.log("\n✍️  Please approve the signature on your Ledger device...");
  const signature = await signAuxParamsWithLedger(
    deploymentParams,
    ledgerSigner,
    accountInfo.address
  );
  console.log("✅ Signature obtained");
  console.log(`   r: ${signature.r}`);
  console.log(`   s: ${signature.s}`);

  // Step 6: Build factory calldata
  console.log("\n📦 Building factory calldata...");
  const calldata = buildFactoryCalldata(
    accountInfo.publicKey,
    deploymentParams,
    signature,
  );

  // Step 7: Deploy account using deployer
  console.log("\n🚢 Deploying Braavos account...");
  console.log(`   Factory Address: ${FACTORY_ADDRESS}`);
  const { transaction_hash } = await deployer.execute({
    contractAddress: FACTORY_ADDRESS,
    entrypoint: "deploy_braavos_account",
    calldata,
  });

  console.log(`   Transaction Hash: ${transaction_hash}`);

  // Step 8: Wait for deployment confirmation
  console.log("\n⏳ Waiting for deployment confirmation...");
  const receipt = await provider.waitForTransaction(transaction_hash, {
    retryInterval: 5000,
  });

  if (!receipt.isSuccess) {
    await transport.close();
    throw new Error("Deployment transaction failed");
  }

  console.log("✅ Deployment successful!");

  // Step 9: Get and save class hash
  const classHash = await provider.getClassHashAt(accountInfo.address);
  saveCreds({ ...accountInfo, classHash });

  // Step 10: Fund the account
  console.log("\n💰 Funding deployed account...");
  const fundTxHash = await fundAccount(accountInfo.address);
  const fundReceipt = await provider.waitForTransaction(fundTxHash, {
    retryInterval: 5000,
  });

  if (!fundReceipt.isSuccess) {
    await transport.close();
    throw new Error("Funding transaction failed");
  }

  console.log("✅ Funding successful!");

  // Close Ledger connection
  await transport.close();
  console.log("\n✅ Ledger connection closed");

  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`Account Address: ${accountInfo.address}`);
  console.log(`Public Key: ${accountInfo.publicKey}`);
  console.log(`Class Hash: ${classHash}`);
  console.log(`Deployment Tx: ${transaction_hash}`);
  console.log(`Funding Tx: ${fundTxHash}`);
  console.log("=".repeat(60));
}

main().catch(async (error) => {
  console.error("\n❌ Deployment failed:", error.message);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
