import { FACTORY_ADDRESS } from "../config/constants";
import { deployer, provider, saveCreds, signAuxParams } from "../utils";
import { BaseAccountInfo } from "../types";
import { buildFactoryCalldata } from "../helpers/calls";

interface DeployBraavosAccountParams {
  creds: BaseAccountInfo;
  deploymentParams: bigint[];
}

export async function deployBraavosAccount(params: DeployBraavosAccountParams) {
  const { creds, deploymentParams } = params;

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

  const receipt = await provider.waitForTransaction(transaction_hash, {
    retryInterval: 5000,
  });
  const classHash = await provider.getClassHashAt(creds.address);
  saveCreds({ ...creds, classHash });

  if (!receipt.isSuccess) {
    throw new Error("Deployment failed");
  }

  return {
    address: creds.address,
    publicKey: creds.publicKey,
    privateKey: creds.privateKey,
    transactionHash: transaction_hash,
  };
}

// if (require.main === module) {
//   const { generateCreds, buildDeploymentParams, fundAccount } = require("../utils");

//   const creds = generateCreds();
//   const deploymentParams = buildDeploymentParams({
//     feeRate: 0n,
//     multisigThreshold: 0n,
//     secpX: 0n,
//     secpY: 0n,
//     starkFeeRate: 0n,
//     withdrawalLimit: 0n,
//   });

//   deployBraavosAccount({ creds, deploymentParams })
//     .then(async (d) => {
//       const txHash = await fundAccount(d.address);
//       const receipt = await provider.waitForTransaction(txHash, {
//         retryInterval: 5000,
//       });
//       if (!receipt.isSuccess) {
//         throw new Error("Transaction failed");
//       }
//       console.log("Funding successful!");
//       console.log(`Transaction: ${txHash}`);
//     })
//     .catch((error) => {
//       console.error("\n❌ Deployment failed:", error.message);
//       if (error instanceof Error && error.stack) {
//         console.error(error.stack);
//       }
//       process.exit(1);
//     });
// }
