#!/usr/bin/env node
import { FACTORY_ADDRESS } from "./config";
import {
  buildDeploymentParams,
  buildFactoryCalldata,
  deployer,
  fundAccount,
  generateCreds,
  provider,
  saveCreds,
  saveSigner,
  signAuxParams,
} from "./utils";
import { generateSecp256r1KeyPair } from "./helpers/secp256r1";

async function deployBraavosAccount() {
  console.log("🚀 Deploying Braavos Account\n");
  const creds = generateCreds();
  console.log(`📍 Address: ${creds.address}`);

  // Generate mock secp256r1 signer (hardware wallet imitation)
  // const secp256r1KeyPair = generateSecp256r1KeyPair();
  // console.log(`🔐 Generated secp256r1 signer (hardware wallet):`);
  // console.log(`   X: ${secp256r1KeyPair.publicKey.x.toString()}`);
  // console.log(`   Y: ${secp256r1KeyPair.publicKey.y.toString()}\n`);

  const deploymentParams = buildDeploymentParams({
    feeRate: 0n,
    multisigThreshold: 0n,
    secpX: 0n, // secp256r1KeyPair.publicKey.x,
    secpY: 0n, // secp256r1KeyPair.publicKey.y,
    starkFeeRate: 0n,
    withdrawalLimit: 0n,
  });

  const signature = signAuxParams(deploymentParams, creds.privateKey);
  const calldata = buildFactoryCalldata(
    creds.publicKey,
    deploymentParams,
    signature,
  );

  const { transaction_hash } = await deployer.execute({
    contractAddress: FACTORY_ADDRESS,
    entrypoint: "deploy_braavos_account",
    calldata,
  });

  console.log(`✅ Transaction submitted: ${transaction_hash}`);
  console.log("⏳ Waiting for confirmation...\n");

  const receipt = await provider.waitForTransaction(transaction_hash, {
    retryInterval: 5000,
  });
  const classHash = await provider.getClassHashAt(creds.address);
  console.log(`Class hash: ${classHash}`);
  saveCreds({ ...creds, classHash });

  // Save secp256r1 signer info
  // const privateKeyHex =
  //   "0x" + Buffer.from(secp256r1KeyPair.privateKey).toString("hex");
  // saveSigner({
  //   privateKey: privateKeyHex,
  //   publicKeyX: secp256r1KeyPair.publicKey.x.toString(),
  //   publicKeyY: secp256r1KeyPair.publicKey.y.toString(),
  // });

  if (!receipt.isSuccess) {
    throw new Error("Transaction failed");
  }

  console.log("✅ Deployment successful!\n");
  console.log(`Transaction: ${transaction_hash}`);

  return {
    address: creds.address,
    publicKey: creds.publicKey,
    privateKey: creds.privateKey,
    transactionHash: transaction_hash,
  };
}

deployBraavosAccount()
  .then(async (d) => {
    const txHash = await fundAccount(d.address);
    const receipt = await provider.waitForTransaction(txHash, {
      retryInterval: 5000,
    });
    if (!receipt.isSuccess) {
      throw new Error("Transaction failed");
    }
    console.log("Funding successful!");
    console.log(`Transaction: ${txHash}`);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error.message);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
