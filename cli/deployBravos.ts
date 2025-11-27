#!/usr/bin/env node
import { CompiledContract, CompiledSierraCasm } from "starknet";
import { DeclareResult } from "./types";
import { config } from "./config";
import {
  buildDeploymentParams,
  buildFactoryCalldata,
  DEFAULT_RESOURCE_BOUNDS,
  deployer,
  fundAccount,
  provider,
  readBaseCredentials,
  readJsonFile,
  resolveArtifactPath,
  signAuxParams,
} from "./utils";

async function deployBraavosAccount() {
  const { address, privateKey, publicKey } = readBaseCredentials();
  console.log("Reusing base account credentials:", address);
  console.log("address:", address);

  const fundingTx = await fundAccount(address);
  await provider.waitForTransaction(fundingTx);

  const { classHash } = await declareBravosClass();
  const deploymentParams = buildDeploymentParams({}, classHash);
  const signature = signAuxParams(deploymentParams, privateKey);
  const fullParams = [...deploymentParams, signature.r, signature.s];

  const calldata = buildFactoryCalldata(publicKey, fullParams);

  const { transaction_hash } = await deployer.execute(
    {
      contractAddress: config.factoryAddress,
      entrypoint: "deploy_braavos_account",
      calldata,
    },
    {
      skipValidate: true,
      resourceBounds: DEFAULT_RESOURCE_BOUNDS,
    },
  );

  console.log("Deployment transaction:", transaction_hash);
  console.log("Braavos account deployed at:", address);
}

async function declareBravosClass(): Promise<DeclareResult> {
  const sierra = readJsonFile<CompiledContract>(
    resolveArtifactPath(config.sierraName),
  );
  const casm = readJsonFile<CompiledSierraCasm>(
    resolveArtifactPath(config.casmName),
  );

  const result = await deployer.declareIfNot({
    contract: sierra,
    casm,
  });

  await provider.waitForTransaction(result.transaction_hash);
  console.log("Bravos account class hash:", result.class_hash);

  return {
    classHash: result.class_hash,
    transactionHash: result.transaction_hash,
  };
}

deployBraavosAccount().catch((error) => {
  console.error("Failed to deploy Braavos account:", error);
  process.exit(1);
});
