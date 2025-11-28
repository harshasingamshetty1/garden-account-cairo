#!/usr/bin/env node
import { config } from "./config";
import { BaseAccountInfo } from "./types";
import {
  buildUdcCalldata,
  deployer,
  generateCredentials,
  provider,
  saveBaseCredentials,
} from "./utils";

// TODO: Make this a little bit cleaner and use classhash by declaring approach(similar to deploy bravos), already wrote the functions needed but it's failing need to checkthis a bit

async function deployBraavosViaUDC(): Promise<BaseAccountInfo> {
  console.log("Deploying Braavos Base");
  const creds = generateCredentials();
  const baseClassHash = config.baseClassHash;
  console.log("Generated account credentials:");
  console.log("  Address:", creds.address);
  console.log("  Public key:", creds.publicKey);
  console.log("  Private key:", creds.privateKey);
  console.log("  Salt:", creds.salt);

  const calldata = buildUdcCalldata(baseClassHash, creds.salt, creds.publicKey);
  const txHash = await submitDeployment(calldata);

  console.log("Transaction hash:", txHash);
  await provider.waitForTransaction(txHash);

  const classHash = await provider.getClassHashAt(deployer.address);
  const deployed = { ...creds, classHash };
  saveBaseCredentials(deployed);
  return deployed;
}

async function submitDeployment(calldata: string[]) {
  const result = await deployer.execute(
    {
      contractAddress: config.udcAddress,
      entrypoint: "deployContract",
      calldata,
    },
    {
      skipValidate: true,
    },
  );
  return result.transaction_hash;
}

deployBraavosViaUDC()
  .then((creds) => {
    console.log("Deployment complete!");
    console.log("Base account address:", creds.address);
    console.log("Base account Class hash:", creds.classHash);
    console.log("Base account calldata:", creds.constructorCalldata);
  })
  .catch((error) => {
    console.error("Failed to deploy base account:", error);
    process.exit(1);
  });
