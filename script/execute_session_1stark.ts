#!/usr/bin/env node
/**
 * execute_session_1stark.ts
 *
 * Executes a V2 session to transfer EXACTLY 1 STRK.
 * This should SUCCEED because the session was created with calldata validation
 * restricting amount to 1 STRK.
 *
 * Usage:
 *   npx ts-node script/execute_session_1stark.ts
 */

import { Account, RpcProvider, hash } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const configDir = path.join(process.cwd(), "script");
dotenv.config({ path: path.join(configDir, ".env") });

const SCRIPT_DIR = path.resolve(process.cwd(), "script");

// 1 STRK = 1e18
const ONE_STRK = 1000000000000000000n;

interface SessionDataV2 {
  sessionType: string;
  sessionVersion: string;
  braavosAccountAddress: string;
  chainId: string;
  sessionHash: string;
  executeAfter: string;
  executeBefore: string;
  sessionCaller?: string;
  sessionCallerPrivateKey?: string;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    selectorHex: string;
    guid: string;
    calldataValidations: Array<{
      offset: number;
      value: string;
      validationType: number;
    }>;
  }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: string;
  }>;
  restrictedAmount: string;
  signature: {
    r: string;
    s: string;
  };
}

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function splitU256(value: bigint): [string, string] {
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;
  return [toHex(low), toHex(high)];
}

async function main() {
  console.log("===========================================");
  console.log("  EXECUTE V2 SESSION: Transfer 1 STRK");
  console.log("  Expected: ✅ SUCCESS");
  console.log("===========================================\n");

  const rpcUrl = process.env.STARKNET_NODE_URL;
  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // Load V2 session data
  const sessionDataPath = path.join(SCRIPT_DIR, "session_data_v2.json");

  if (!fs.existsSync(sessionDataPath)) {
    console.error(`Session data not found at ${sessionDataPath}`);
    console.error("Run create_session_v2.ts first");
    process.exit(1);
  }

  const sessionData: SessionDataV2 = JSON.parse(
    fs.readFileSync(sessionDataPath, "utf8")
  );

  console.log("=== Session Data ===");
  console.log(`Type: ${sessionData.sessionType}`);
  console.log(`Version: ${sessionData.sessionVersion}`);
  console.log(`Braavos Account: ${sessionData.braavosAccountAddress}`);
  console.log(`Session Hash: ${sessionData.sessionHash}`);
  console.log(`Restricted Amount: ${sessionData.restrictedAmount} (1 STRK)`);

  // Get caller credentials
  const callerPrivateKey =
    process.env.CALLER_PRIVATE_KEY ??
    sessionData.sessionCallerPrivateKey ??
    process.env.DEPLOYER_PRIVATE_KEY;
  const callerAddress = process.env.CALLER_ADDRESS ?? sessionData.sessionCaller;

  if (!callerPrivateKey || !callerAddress) {
    console.error("Missing session caller credentials");
    process.exit(1);
  }

  // Transfer recipient (default to deployer)
  const transferRecipient =
    process.env.TRANSFER_RECIPIENT ??
    process.env.DEPLOYER_ADDRESS ??
    callerAddress;

  // Transfer EXACTLY 1 STRK
  const transferAmount = ONE_STRK;
  const [amountLow, amountHigh] = splitU256(transferAmount);

  console.log(`\n📤 Transferring: 1 STRK (${transferAmount.toString()})`);
  console.log(`   To: ${transferRecipient}`);
  console.log(`   Amount Low: ${amountLow}`);
  console.log(`   Amount High: ${amountHigh}`);

  const targetMethod = sessionData.allowedMethods[0];
  const actualCall = {
    contractAddress: targetMethod.contractAddress,
    entrypoint: targetMethod.selector,
    calldata: [transferRecipient, amountLow, amountHigh],
  };

  console.log("\n=== Call to Execute ===");
  console.log(`Contract: ${actualCall.contractAddress}`);
  console.log(`Entrypoint: ${actualCall.entrypoint}`);
  console.log(`Calldata: ${JSON.stringify(actualCall.calldata)}`);

  // Create caller account
  const callerAccount = new Account({
    provider: provider,
    address: callerAddress,
    signer: callerPrivateKey,
  });

  // Build V2 GasSponsoredSessionExecutionRequest calldata
  // Structure: execute_after, execute_before, allowed_method_guids[], spending_limits[],
  //            calldata_validations[][], calls[], call_hints[]

  const gsSessionCalldata: string[] = [
    // execute_after
    sessionData.executeAfter,
    // execute_before
    sessionData.executeBefore,
    // allowed_method_guids (array)
    "1", // length
    targetMethod.guid,
    // spending_limits (array)
    sessionData.spendingLimits.length.toString(),
    ...sessionData.spendingLimits.flatMap((l) => {
      const [low, high] = splitU256(BigInt(l.amount));
      return [l.tokenAddress, low, high];
    }),
    // allowed_method_calldata_validations (array of arrays)
    "1", // length (one method)
    targetMethod.calldataValidations.length.toString(), // validations for method 0
    ...targetMethod.calldataValidations.flatMap((cv) => [
      cv.offset.toString(),
      cv.value,
      cv.validationType.toString(),
    ]),
    // calls (array of Call structs)
    "1", // length
    actualCall.contractAddress, // to
    targetMethod.selectorHex, // selector
    actualCall.calldata.length.toString(), // calldata length
    ...actualCall.calldata,
    // call_hints (array)
    "1", // length
    "0", // hint for first call
  ];

  // signature (array)
  const signatureCalldata = [
    "2", // length
    sessionData.signature.r,
    sessionData.signature.s,
  ];

  console.log("\n=== Executing V2 GasSponsoredSession ===");
  console.log("Caller Address:", callerAddress);
  console.log("Braavos Account:", sessionData.braavosAccountAddress);

  try {
    const tx = await callerAccount.execute([
      {
        contractAddress: sessionData.braavosAccountAddress,
        entrypoint: "execute_gas_sponsored_session_tx_v2",
        calldata: [...gsSessionCalldata, ...signatureCalldata],
      },
    ]);

    console.log("\nTx submitted:", tx.transaction_hash);
    console.log(
      `View on Starkscan: https://sepolia.starkscan.co/tx/${tx.transaction_hash}`
    );

    const receipt = await provider.waitForTransaction(tx.transaction_hash, {
      retryInterval: 5000,
    });

    const success =
      typeof receipt.isSuccess === "function"
        ? receipt.isSuccess()
        : receipt.isSuccess;

    if (success) {
      console.log("\n✅ Tx status: SUCCEEDED");
      console.log("1 STRK transferred successfully!");
    } else {
      console.log("\n❌ Tx status: FAILED");
      console.error("Transaction failed unexpectedly!");
    }
  } catch (err: any) {
    console.error("\n❌ Failed to execute session:", err?.message ?? err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
