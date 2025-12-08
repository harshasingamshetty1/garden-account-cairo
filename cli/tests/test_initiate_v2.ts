#!/usr/bin/env node
import { provider } from "../utils";
import { readJsonFile } from "../helpers/file";
import { Account, Call, hash } from "starknet";
import path from "path";
import { config } from "../config/constants";

interface CalldataValidation {
  offset: number;
  value: string;
  validation_type: number;
}

interface SessionInfoV2 {
  sessionHash: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    calldataValidations?: CalldataValidation[];
  }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  signature: string[];
  htlcAddress: string;
  braavosAccount: string;
  createdAt: string;
}

/**
 * Parse allowed method GUIDs for V2 sessions
 * For V2, the GUID includes calldata validations
 * Matches the Cairo implementation in sessions/hash.cairo
 */
function getAllowedMethodGuidsV2(
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    calldataValidations?: CalldataValidation[];
  }>,
): string[] {
  // ALLOWED_METHOD_TYPE_HASH for V2 sessions (with calldata validations)
  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation**")',
  );

  const CALLDATA_VALIDATION_TYPE_HASH = hash.getSelectorFromName(
    '"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  return allowedMethods.map((method) => {
    const validations = method.calldataValidations || [];

    // Hash calldata validations
    const validationHashes = validations.map((v) =>
      hash.computePoseidonHashOnElements([
        CALLDATA_VALIDATION_TYPE_HASH,
        v.offset.toString(),
        v.value,
        v.validation_type.toString(),
      ]),
    );

    // Hash the array of validation hashes
    // For empty span: just hash the length (0)
    const validationsHash =
      validationHashes.length > 0
        ? hash.computePoseidonHashOnElements([
            validationHashes.length.toString(),
            ...validationHashes,
          ])
        : hash.computePoseidonHashOnElements([validationHashes.length.toString()]);

    // For V2: Hash: [type_hash, contract_address, selector, validations_hash]
    return hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH,
      method.contractAddress,
      method.selector,
      validationsHash,
    ]);
  });
}

/**
 * Build calldata for execute_gas_sponsored_session_tx_v2
 */
function buildGasSponsoredSessionCalldataV2(
  sessionInfo: SessionInfoV2,
  calls: Call[],
  callHints: number[],
): string[] {
  const allowedMethodGuids = getAllowedMethodGuidsV2(sessionInfo.allowedMethods);

  const calldata: string[] = [];

  // Execute after (u64)
  calldata.push(sessionInfo.executeAfter.toString());

  // Execute before (u64)
  calldata.push(sessionInfo.executeBefore.toString());

  // Allowed methods GUIDs (length + guids)
  calldata.push(allowedMethodGuids.length.toString());
  calldata.push(...allowedMethodGuids);

  // Spending limits (length + [token_address, amount.low, amount.high]*)
  calldata.push(sessionInfo.spendingLimits.length.toString());
  for (const limit of sessionInfo.spendingLimits) {
    calldata.push(limit.tokenAddress);
    calldata.push(limit.amount.low);
    calldata.push(limit.amount.high);
  }

  // Calldata validations (V2 only) - Span<Span<CalldataValidation>>
  // Outer array: one per method
  calldata.push(sessionInfo.allowedMethods.length.toString());
  for (const method of sessionInfo.allowedMethods) {
    const validations = method.calldataValidations || [];
    calldata.push(validations.length.toString());
    for (const validation of validations) {
      calldata.push(validation.offset.toString());
      calldata.push(validation.value);
      calldata.push(validation.validation_type.toString());
    }
  }

  // Calls - Span<Call> format: [length, call1_to, call1_selector, call1_calldata_len, ...call1_calldata, ...]
  calldata.push(calls.length.toString()); // Number of calls
  for (const call of calls) {
    calldata.push(call.contractAddress); // to
    calldata.push(
      call.entrypoint ? hash.getSelectorFromName(call.entrypoint) : "0",
    ); // selector
    const callCalldata = Array.isArray(call.calldata) ? call.calldata : [];
    calldata.push(callCalldata.length.toString()); // calldata length
    calldata.push(...callCalldata.map((c) => c.toString())); // calldata elements
  }

  // Call hints (length + hints)
  calldata.push(callHints.length.toString());
  calldata.push(...callHints.map((h) => h.toString()));

  // Signature (length + signature elements)
  calldata.push(sessionInfo.signature.length.toString());
  calldata.push(...sessionInfo.signature);

  return calldata;
}

async function executeSessionTransactionV2() {
  console.log("🚀 HTLC Session Execute Script (V2)\n");

  try {
    // Read session info
    const sessionFile = path.join(
      path.dirname(config.credsFile),
      "session.json",
    );

    const sessionInfo = readJsonFile<SessionInfoV2>(sessionFile);
    console.log(`📄 Loaded session from: ${sessionFile}`);
    console.log(`   Session Hash: ${sessionInfo.sessionHash}`);
    console.log(`   Braavos Account: ${sessionInfo.braavosAccount}`);
    console.log(`   Caller: ${sessionInfo.caller}`);

    // Check if session is still valid
    const now = Math.floor(Date.now() / 1000);
    if (now < sessionInfo.executeAfter) {
      console.error(`❌ Error: Session not yet active`);
      console.error(`   Current time: ${new Date(now * 1000).toISOString()}`);
      console.error(
        `   Active from: ${new Date(sessionInfo.executeAfter * 1000).toISOString()}`,
      );
      process.exit(1);
    }

    if (now > sessionInfo.executeBefore) {
      console.error(`❌ Error: Session has expired`);
      console.error(`   Current time: ${new Date(now * 1000).toISOString()}`);
      console.error(
        `   Expired at: ${new Date(sessionInfo.executeBefore * 1000).toISOString()}`,
      );
      process.exit(1);
    }

    console.log(
      `✅ Session is valid until ${new Date(sessionInfo.executeBefore * 1000).toISOString()}\n`,
    );

    // Get caller's private key from environment
    const CALLER_PRIVATE_KEY = process.env.CALLER_PRIVATE_KEY;
    if (!CALLER_PRIVATE_KEY) {
      console.error(
        `❌ Error: CALLER_PRIVATE_KEY environment variable is required`,
      );
      console.error(
        `   This should be the private key of the address: ${sessionInfo.caller}`,
      );
      process.exit(1);
    }

    // Create caller account
    const callerAccount = new Account({
      provider,
      address: sessionInfo.caller,
      signer: CALLER_PRIVATE_KEY,
    });

    console.log(`👤 Using caller account: ${sessionInfo.caller}\n`);

    // Parse command line arguments
    function getArg(flag: string): string | undefined {
      const index = process.argv.indexOf(flag);
      return index >= 0 && index < process.argv.length - 1
        ? process.argv[index + 1]
        : undefined;
    }

    // Get operation from command line argument
    const operation =
      getArg("--function")?.toLowerCase() || process.argv[2]?.toLowerCase();
    if (!operation || !["initiate", "redeem", "refund"].includes(operation)) {
      console.error(`❌ Error: Invalid or missing operation`);
      console.error(
        `   Usage: tsx cli/tests/test_initiate_v2.ts --function <operation> [args...]`,
      );
      console.error(`   Operations: initiate, redeem, refund`);
      process.exit(1);
    }

    console.log(`📋 Operation: ${operation}`);

    // Build the call based on operation
    let htlcCall: Call;

    switch (operation) {
      case "initiate":
        const recipient = getArg("--recipient") || process.argv[3];
        const amount = getArg("--amount") || process.argv[4];
        const timelock = getArg("--timelock") || process.argv[5];
        const secretHashInput = getArg("--secret-hash") || process.argv[6];

        if (!recipient || !amount || !timelock || !secretHashInput) {
          console.error(`❌ Error: Missing arguments for initiate`);
          console.error(
            `   Usage: tsx cli/tests/test_initiate_v2.ts initiate <recipient> <amount> <timelock> <secret_hash>`,
          );
          console.error(`   Secret hash can be:`);
          console.error(
            `     - Comma-separated: "0x0cbd0a5e,0xd68a0942,0xc7f2a01f,0x0578a41d,0x05a16814,0x501fc9e3,0xef67f1ec,0xef7f30ee"`,
          );
          console.error(
            `     - Full hex: 0x0cbd0a5ed68a0942c7f2a01f0578a41d05a16814501fc9e3ef67f1ecef7f30ee`,
          );
          process.exit(1);
        }

        // Parse secret hash input
        let secretHashArray: string[];

        if (secretHashInput.includes(",")) {
          secretHashArray = secretHashInput
            .replace(/[\[\]\s]/g, "")
            .split(",")
            .map((h) => h.trim());
        } else {
          const cleanHex = secretHashInput.replace("0x", "");
          if (cleanHex.length !== 64) {
            console.error(
              `❌ Error: Secret hash hex must be 64 characters (32 bytes)`,
            );
            process.exit(1);
          }

          secretHashArray = [];
          for (let i = 0; i < 8; i++) {
            const chunk = cleanHex.slice(i * 8, (i + 1) * 8);
            secretHashArray.push("0x" + chunk);
          }
        }

        if (secretHashArray.length !== 8) {
          console.error(
            `❌ Error: Secret hash must have exactly 8 u32 values, got ${secretHashArray.length}`,
          );
          process.exit(1);
        }

        console.log(`📝 Secret hash (u32 array):`, secretHashArray);

        const initiateCalldata = [
          recipient,
          timelock,
          amount,
          "0",
          ...secretHashArray,
        ];

        htlcCall = {
          contractAddress: sessionInfo.htlcAddress,
          entrypoint: "initiate",
          calldata: initiateCalldata,
        };
        break;

      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    console.log(`   Contract: ${htlcCall.contractAddress}`);
    console.log(`   Entrypoint: ${htlcCall.entrypoint}`);

    // Find the index of this method in allowed methods
    const methodIndex = sessionInfo.allowedMethods.findIndex(
      (m) =>
        m.contractAddress === htlcCall.contractAddress &&
        m.selector === hash.getSelectorFromName(htlcCall.entrypoint!),
    );

    if (methodIndex === -1) {
      console.error(
        `❌ Error: Operation ${operation} is not allowed in this session`,
      );
      process.exit(1);
    }

    // Call hints indicate which allowed method index is being used
    const callHints = [methodIndex];

    // Build the V2 session execution calldata
    const sessionCalldata = buildGasSponsoredSessionCalldataV2(
      sessionInfo,
      [htlcCall],
      callHints,
    );

    // Debug: show GUIDs and calldata structure
    console.log("\n🔍 Debug Info:");
    const guids = getAllowedMethodGuidsV2(sessionInfo.allowedMethods);
    guids.forEach((guid, idx) => {
      const methodName = ["initiate", "redeem", "refund"][idx];
      const validations = sessionInfo.allowedMethods[idx].calldataValidations || [];
      console.log(`   ${methodName} GUID: ${guid}`);
      console.log(`     Validations: ${validations.length}`);
      console.log(`     Method: ${sessionInfo.allowedMethods[idx].contractAddress}`);
      console.log(`     Selector: ${sessionInfo.allowedMethods[idx].selector}`);
    });

    console.log("\n📦 Calldata Summary:");
    console.log(`   Total calldata elements: ${sessionCalldata.length}`);
    console.log(`   First 10: ${sessionCalldata.slice(0, 10).join(", ")}`);
    console.log(`   Signature (last 3): ${sessionCalldata.slice(-3).join(", ")}`);

    // Create the call to execute_gas_sponsored_session_tx_v2 on the Braavos account
    const executeCall: Call = {
      contractAddress: sessionInfo.braavosAccount,
      entrypoint: "execute_gas_sponsored_session_tx_v2",
      calldata: sessionCalldata,
    };

    console.log(`\n🎯 V2 Entrypoint Selector: ${hash.getSelectorFromName("execute_gas_sponsored_session_tx_v2")}`);

    console.log(`\n🚀 Executing V2 session transaction...`);

    // Execute the transaction
    const response = await callerAccount.execute(executeCall);

    console.log(`✅ Transaction submitted: ${response.transaction_hash}`);
    console.log(`⏳ Waiting for confirmation...\n`);

    // Wait for transaction to be confirmed
    const receipt = await provider.waitForTransaction(
      response.transaction_hash,
      {
        retryInterval: 5000,
      },
    );

    if (receipt.isSuccess()) {
      console.log(`✅ Transaction confirmed successfully!`);
      console.log(`   Transaction hash: ${response.transaction_hash}`);
      console.log(`\n📝 Note: This used execute_gas_sponsored_session_tx_v2 with calldata validation`);
    } else {
      console.error(`❌ Transaction failed`);
      console.error(`   Transaction hash: ${response.transaction_hash}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `\n❌ Error:`,
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
executeSessionTransactionV2();
