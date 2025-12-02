#!/usr/bin/env node
import { Account, hash, num } from "starknet";
import { provider, readCreds } from "./utils";
import {
  generateSecp256r1KeyPair,
  secp256r1PubKeyToStringArray,
  secp256r1KeyPairFromPrivateKey,
  signHashWithSecp256r1,
} from "./helpers/secp256r1";
import { DeploymentSignerType } from "./types";
import { config } from "./config";

async function addSecp256r1Signer() {
  console.log("🔐 Adding secp256r1 signer to Braavos Account\n");

  const creds = readCreds();
  console.log(`📍 Account Address: ${creds.address}\n`);

  const existingSecp256r1PrivateKey =
    process.env.EXISTING_SECP256R1_PRIVATE_KEY;
  if (!existingSecp256r1PrivateKey) {
    throw new Error(
      "❌ EXISTING_SECP256R1_PRIVATE_KEY environment variable is required",
    );
  }

  const existingKeyPair = secp256r1KeyPairFromPrivateKey(
    existingSecp256r1PrivateKey,
  );
  console.log(`🔑 Using existing secp256r1 signer\n`);

  // Generate new signer
  const newSigner = generateSecp256r1KeyPair();
  console.log(`🔑 Generated new secp256r1 signer\n`);

  const addSignerCalldata = [
    ...secp256r1PubKeyToStringArray(newSigner), // 4 felts: x_low, x_high, y_low, y_high
    DeploymentSignerType.Secp256r1.toString(), // signer_type
    "0", // multisig_threshold
  ];
  console.log(`🔑 Add signer calldata: ${addSignerCalldata.join(", ")}\n`);

  const account = new Account({
    provider,
    address: creds.address,
    signer: {
      async signTransaction(transactions, details) {
        const callsArray = Array.isArray(transactions)
          ? transactions
          : [transactions];

        let calldataArray: string[];
        if (
          callsArray.length === 1 &&
          callsArray[0].entrypoint === "__execute__"
        ) {
          calldataArray = callsArray[0].calldata;
        } else {
          // Format calls for __execute__
          calldataArray = [
            callsArray.length.toString(),
            ...callsArray.flatMap((call) => {
              const selector =
                call.entrypoint.startsWith("0x") &&
                call.entrypoint.length === 66
                  ? call.entrypoint
                  : hash.getSelectorFromName(call.entrypoint);
              return [
                call.contractAddress,
                selector,
                call.calldata.length.toString(),
                ...call.calldata,
              ];
            }),
          ];
        }

        console.log(`📝 Calldata for hash: ${calldataArray.join(", ")}\n`);
        console.log(`📝 Resource bounds:`, details.resourceBounds);
        console.log(`📝 Nonce: ${details.nonce}\n`);

        // Ensure resource bounds are non-zero for correct hash calculation
        // If details.resourceBounds has zero values, use defaults
        const resourceBounds = details.resourceBounds || {
          l1_gas: { max_amount: 0x100000n, max_price_per_unit: 0n },
          l2_gas: { max_amount: 0x100000n, max_price_per_unit: 0n },
          l1_data_gas: { max_amount: 0x100000n, max_price_per_unit: 0n },
        };

        // Check if any max_amount is zero and use defaults if so
        const finalResourceBounds = {
          l1_gas: {
            max_amount:
              resourceBounds.l1_gas?.max_amount === 0n ||
              resourceBounds.l1_gas?.max_amount === undefined
                ? 0x100000n
                : resourceBounds.l1_gas.max_amount,
            max_price_per_unit: resourceBounds.l1_gas?.max_price_per_unit || 0n,
          },
          l2_gas: {
            max_amount:
              resourceBounds.l2_gas?.max_amount === 0n ||
              resourceBounds.l2_gas?.max_amount === undefined
                ? 0x100000n
                : resourceBounds.l2_gas.max_amount,
            max_price_per_unit: resourceBounds.l2_gas?.max_price_per_unit || 0n,
          },
          l1_data_gas: {
            max_amount:
              resourceBounds.l1_data_gas?.max_amount === 0n ||
              resourceBounds.l1_data_gas?.max_amount === undefined
                ? 0x100000n
                : resourceBounds.l1_data_gas.max_amount,
            max_price_per_unit:
              resourceBounds.l1_data_gas?.max_price_per_unit || 0n,
          },
        };

        console.log(`📝 Final resource bounds:`, finalResourceBounds);

        const txHash = hash.calculateInvokeTransactionHash({
          senderAddress: creds.address,
          compiledCalldata: calldataArray,
          nonce: details.nonce,
          chainId: config.chainId as any,
          version: details.version as any,
          accountDeploymentData: [],
          nonceDataAvailabilityMode: 0,
          feeDataAvailabilityMode: 0,
          resourceBounds: finalResourceBounds,
          tip: "0x0",
          paymasterData: [],
        });

        console.log(`📝 Transaction hash to sign: ${txHash}\n`);

        const signature = signHashWithSecp256r1(
          BigInt(txHash),
          existingKeyPair.privateKey,
          existingKeyPair.publicKey,
        );

        console.log(`✍️ Generated signature (${signature.length} elements)\n`);

        return signature;
      },
      async getPubKey() {
        return "0x" + existingKeyPair.publicKey.x.toString(16);
      },
    } as any,
  });

  console.log("⏳ Submitting transaction...\n");

  try {
    const { transaction_hash } = await account.execute({
      contractAddress: creds.address,
      entrypoint: "add_secp256r1_signer",
      calldata: addSignerCalldata,
    });

    console.log(`✅ Transaction submitted: ${transaction_hash}`);
    console.log("⏳ Waiting for confirmation...\n");

    const receipt = await provider.waitForTransaction(transaction_hash, {
      retryInterval: 5000,
    });

    if (!receipt.isSuccess) {
      throw new Error("Transaction failed");
    }

    console.log("✅ Signer added successfully!\n");
    console.log(`Transaction: ${transaction_hash}`);
    console.log(`\n🔑 New Signer Details:`);
    console.log(
      `Private Key: 0x${Buffer.from(newSigner.privateKey).toString("hex")}`,
    );
    console.log(`Public Key X: ${newSigner.publicKey.x.toString()}`);
    console.log(`Public Key Y: ${newSigner.publicKey.y.toString()}`);
  } catch (error) {
    console.error("\n❌ Failed to add signer:", error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

addSecp256r1Signer().catch((error) => {
  console.error("\n❌ Script failed:", error.message);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
