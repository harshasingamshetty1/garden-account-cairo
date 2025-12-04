#!/usr/bin/env node
import { provider } from "../utils";
import { readJsonFile } from "../helpers/file";
import { Account, Call, CallData, hash } from "starknet";
import path from "path";
import { config } from "../config";

interface SessionInfo {
  sessionHash: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
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
 * Parse allowed method GUIDs for V1 sessions
 * For V1, the GUID is just a hash of type_hash + contract address + selector
 * Matches the Cairo implementation in sessions/hash.cairo
 */
function getAllowedMethodGuids(
  allowedMethods: Array<{ contractAddress: string; selector: string }>,
): string[] {
  // ALLOWED_METHOD_TYPE_HASH for V1 sessions (no calldata validations)
  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
  );

  return allowedMethods.map((method) => {
    // For V1: Hash: [type_hash, contract_address, selector]
    // This matches hash_allowed_method in sessions/hash.cairo for V1
    return hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH,
      method.contractAddress,
      method.selector,
    ]);
  });
}

/**
 * Build calldata for execute_gas_sponsored_session_tx
 */
function buildGasSponsoredSessionCalldata(
  sessionInfo: SessionInfo,
  calls: Call[],
  callHints: number[],
): string[] {
  const allowedMethodGuids = getAllowedMethodGuids(sessionInfo.allowedMethods);

  const calldata: string[] = [];

  // Execute after (u64)
  calldata.push(sessionInfo.executeAfter.toString());

  // Execute before (u64)
  calldata.push(sessionInfo.executeBefore.toString());

  // Allowed methods (length + guids)
  calldata.push(allowedMethodGuids.length.toString());
  calldata.push(...allowedMethodGuids);

  // Spending limits (length + [token_address, amount.low, amount.high]*)
  calldata.push(sessionInfo.spendingLimits.length.toString());
  for (const limit of sessionInfo.spendingLimits) {
    calldata.push(limit.tokenAddress);
    calldata.push(limit.amount.low);
    calldata.push(limit.amount.high);
  }

  // V1 sessions don't have calldata validations - skip that field

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

async function executeSessionTransaction() {
  console.log("🚀 HTLC Session Execute Script\n");

  try {
    // Read session info
    const sessionFile = path.join(
      path.dirname(config.credsFile),
      "session.json",
    );

    const sessionInfo = readJsonFile<SessionInfo>(sessionFile);
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
        `   Usage: tsx cli/session-execute.ts --function <operation> [args...]`,
      );
      console.error(`   Operations: initiate, redeem, refund`);
      process.exit(1);
    }

    console.log(`📋 Operation: ${operation}`);

    // Build the call based on operation
    // Note: You'll need to adjust the calldata based on your HTLC contract's actual interface
    let htlcCall: Call;

    switch (operation) {
      case "initiate":
        const recipient = getArg("--recipient") || process.argv[3];
        const amount = getArg("--amount") || process.argv[4];
        const timelock = getArg("--timelock") || process.argv[5];
        const secretHashInput = getArg("--secret-hash") || process.argv[6]; // Can be hex string or comma-separated

        if (!recipient || !amount || !timelock || !secretHashInput) {
          console.error(`❌ Error: Missing arguments for initiate`);
          console.error(
            `   Usage: tsx cli/session-execute.ts --function initiate --recipient <address> --amount <amount> --timelock <seconds> --secret-hash <hash>`,
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
          // Comma-separated format
          secretHashArray = secretHashInput
            .replace(/[\[\]\s]/g, "") // Remove brackets and spaces
            .split(",")
            .map((h) => h.trim());
        } else {
          // Full hex string format - split into 8 u32 chunks
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

        // Ensure we have exactly 8 values
        if (secretHashArray.length !== 8) {
          console.error(
            `❌ Error: Secret hash must have exactly 8 u32 values, got ${secretHashArray.length}`,
          );
          process.exit(1);
        }

        console.log(`📝 Secret hash (u32 array):`, secretHashArray);

        // Manually build calldata for initiate
        // fn initiate(redeemer: ContractAddress, timelock: u128, amount: u256, secret_hash: [u32; 8])
        const initiateCalldata = [
          recipient, // redeemer: ContractAddress
          timelock, // timelock: u128 (as string)
          amount, // amount.low: u128 (as string)
          "0", // amount.high: u128
          ...secretHashArray, // secret_hash: [u32; 8] - 8 individual u32 values
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
        m.selector === hash.getSelectorFromName(htlcCall.entrypoint),
    );

    if (methodIndex === -1) {
      console.error(
        `❌ Error: Operation ${operation} is not allowed in this session`,
      );
      process.exit(1);
    }

    // Call hints indicate which allowed method index is being used
    const callHints = [methodIndex];

    // Build the session execution calldata
    const sessionCalldata = buildGasSponsoredSessionCalldata(
      sessionInfo,
      [htlcCall],
      callHints,
    );

    // Create the call to execute_gas_sponsored_session_tx on the Braavos account
    // Using V1 (simpler, no calldata validations)
    const executeCall: Call = {
      contractAddress: sessionInfo.braavosAccount,
      entrypoint: "execute_gas_sponsored_session_tx",
      calldata: sessionCalldata,
    };

    console.log(`\n🚀 Executing session transaction...`);

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
executeSessionTransaction();
