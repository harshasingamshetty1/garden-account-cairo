#!/usr/bin/env node
/**
 * execute_session.ts
 *
 * This script uses a previously created session to execute a call on behalf
 * of a Braavos account.
 *
 * It supports both:
 * 1. SessionExecute - session owner pays gas, signs tx with their session key
 * 2. GasSponsoredSession - external caller pays gas, uses pre-signed session
 *
 * For GasSponsoredSession, the session caller credentials are read from env.
 *
 * Usage:
 *   ts-node execute_session.ts [network] [rpc_url]
 *   ts-node execute_session.ts sepolia https://starknet-sepolia.public.blastapi.io
 *
 * Defaults to Starknet Sepolia if no args provided.
 *
 * Env (required):
 *   DEPLOYER_ADDRESS         - Address of the session caller (pays gas)
 *   DEPLOYER_PRIVATE_KEY     - Private key of the session caller
 *
 * Env (optional):
 *   SESSION_DATA_PATH        - Path to session_data.json (default: ./script/session_data.json)
 *   TRANSFER_RECIPIENT       - Recipient for transfer call (default: DEPLOYER_ADDRESS)
 *   TRANSFER_AMOUNT          - Amount for transfer call (default: 1000000000000000000 = 1e18)
 */

import { Account, RpcProvider, ec, hash, CallData } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// Get script directory - works in both CommonJS and ESM
const SCRIPT_DIR = path.resolve(process.cwd(), "script");

type NetworkType = "sepolia" | "mainnet" | "devnet";

interface SessionData {
  sessionType: "SessionExecute" | "GasSponsoredSession";
  braavosAccountAddress: string;
  chainId: string;
  sessionHash: string;
  executeAfter: string;
  executeBefore: string;
  v3GasLimit?: string;
  sessionCaller?: string;
  sessionCallerPrivateKey?: string;
  sessionOwnerPubKey?: string;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    selectorHex: string;
    guid: string;
  }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: string;
  }>;
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
  const args = process.argv.slice(2);

  // Default to Starknet Sepolia
  let network: NetworkType = "sepolia";
  let rpcUrl = process.env.STARKNET_NODE_URL;

  if (args.length === 2) {
    network = args[0] as NetworkType;
    rpcUrl = args[1];
  } else if (args.length === 1) {
    console.error(
      "Usage: ts-node execute_session.ts [network] [rpc_url]\n" +
        "Defaults to sepolia if no args provided.\n" +
        "Env: SESSION_DATA_PATH, TRANSFER_RECIPIENT, TRANSFER_AMOUNT",
    );
    process.exit(1);
  }

  if (!["sepolia", "mainnet", "devnet"].includes(network)) {
    console.error(
      "Invalid network. Supported networks: sepolia, mainnet, devnet",
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // Load session data
  const sessionDataPath =
    process.env.SESSION_DATA_PATH ?? path.join(SCRIPT_DIR, "session_data.json");

  if (!fs.existsSync(sessionDataPath)) {
    console.error(`Session data not found at ${sessionDataPath}`);
    console.error("Run create_session.ts first to generate session_data.json");
    process.exit(1);
  }

  const sessionData: SessionData = JSON.parse(
    fs.readFileSync(sessionDataPath, "utf8"),
  );

  console.log("=== Session Data ===");
  console.log(`Type: ${sessionData.sessionType}`);
  console.log(`Braavos Account: ${sessionData.braavosAccountAddress}`);
  console.log(`Session Hash: ${sessionData.sessionHash}`);

  // Get transfer params - default to sending 1e18 to the deployer
  const transferRecipient = process.env.TRANSFER_RECIPIENT ?? process.env.DEPLOYER_ADDRESS;
  const transferAmount = process.env.TRANSFER_AMOUNT ?? "1000000000000000000"; // 1e18

  if (!transferRecipient) {
    console.error("Missing TRANSFER_RECIPIENT or DEPLOYER_ADDRESS in env");
    process.exit(1);
  }
  
  console.log(`\n📤 Transfer: ${transferAmount} tokens to ${transferRecipient}`);

  const [amountLow, amountHigh] = splitU256(BigInt(transferAmount));

  // Build the actual call
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

  if (sessionData.sessionType === "SessionExecute") {
    await executeSessionExecute(
      provider,
      sessionData,
      actualCall,
      targetMethod,
    );
  } else {
    await executeGasSponsoredSession(
      provider,
      sessionData,
      actualCall,
      targetMethod,
    );
  }
}

async function executeSessionExecute(
  provider: RpcProvider,
  sessionData: SessionData,
  actualCall: { contractAddress: string; entrypoint: string; calldata: string[] },
  targetMethod: SessionData["allowedMethods"][0],
) {
  const sessionOwnerPrivateKey = process.env.SESSION_OWNER_PRIVATE_KEY;

  if (!sessionOwnerPrivateKey) {
    console.error("Missing SESSION_OWNER_PRIVATE_KEY for SessionExecute");
    process.exit(1);
  }

  // Create account instance for the Braavos account, but we'll sign with session owner key
  // The session owner signs the transaction hash
  const sessionOwnerAccount = new Account({
    provider,
    address: sessionData.braavosAccountAddress,
    signer: sessionOwnerPrivateKey,
  });

  // Build SessionExecuteRequest calldata
  // SessionExecuteRequest {
  //   session_request: SessionExecute {
  //     owner_pub_key: felt252,
  //     execute_after: u64,
  //     execute_before: u64,
  //     allowed_method_guids: Span<felt252>,
  //     v3_gas_limit: u128,
  //     spending_limits: Span<TokenAmount>,
  //   },
  //   call_hints: Span<u32>,
  //   session_request_signature: Span<felt252>,
  // }

  const sessionRequestCalldata: string[] = [
    // owner_pub_key
    sessionData.sessionOwnerPubKey ?? "0x0",
    // execute_after
    sessionData.executeAfter,
    // execute_before
    sessionData.executeBefore,
    // allowed_method_guids (array)
    "1", // length
    targetMethod.guid,
    // v3_gas_limit
    sessionData.v3GasLimit ?? "0",
    // spending_limits (array)
    sessionData.spendingLimits.length.toString(),
    ...sessionData.spendingLimits.flatMap((l) => {
      const [low, high] = splitU256(BigInt(l.amount));
      return [l.tokenAddress, low, high];
    }),
    // call_hints (array) - index 0 for our single call
    "1", // length
    "0", // hint for first call
    // session_request_signature (array)
    "2", // length
    sessionData.signature.r,
    sessionData.signature.s,
  ];

  console.log("\n=== Executing SessionExecute ===");

  try {
    const tx = await sessionOwnerAccount.execute([
      {
        contractAddress: sessionData.braavosAccountAddress,
        entrypoint: "session_execute",
        calldata: sessionRequestCalldata,
      },
      actualCall,
    ]);

    console.log("Tx submitted:", tx.transaction_hash);
    const receipt = await provider.waitForTransaction(tx.transaction_hash, {
      retryInterval: 5000,
    });
    const success =
      typeof receipt.isSuccess === "function"
        ? receipt.isSuccess()
        : receipt.isSuccess;
    console.log("Tx status:", success ? "SUCCEEDED" : "FAILED");
  } catch (err: any) {
    console.error("Failed to execute session:", err?.message ?? err);
    process.exit(1);
  }
}

async function executeGasSponsoredSession(
  provider: RpcProvider,
  sessionData: SessionData,
  actualCall: { contractAddress: string; entrypoint: string; calldata: string[] },
  targetMethod: SessionData["allowedMethods"][0],
) {
  // Get caller credentials from env (DEPLOYER is the session caller by default)
  // Prefer credentials from session_data.json, fallback to env
  const callerPrivateKey =
    process.env.CALLER_PRIVATE_KEY ??
    sessionData.sessionCallerPrivateKey ??
    process.env.DEPLOYER_PRIVATE_KEY;
  const callerAddress =
    process.env.CALLER_ADDRESS ?? sessionData.sessionCaller;

  if (!callerPrivateKey || !callerAddress) {
    console.error(
      "Missing session caller credentials.\n" +
        "Set DEPLOYER_PRIVATE_KEY and ensure sessionCaller is in session_data.json,\n" +
        "or set CALLER_PRIVATE_KEY and CALLER_ADDRESS in env.",
    );
    process.exit(1);
  }

  // Verify the caller matches the session
  if (callerAddress.toLowerCase() !== sessionData.sessionCaller?.toLowerCase()) {
    console.warn(
      `⚠️  Warning: Caller address (${callerAddress}) differs from session caller (${sessionData.sessionCaller})`,
    );
  }

  console.log(`Session Caller Address: ${callerAddress}`);

  // The caller account will call execute_gas_sponsored_session_tx on the Braavos account
  const callerAccount = new Account({
    provider,
    address: callerAddress,
    signer: callerPrivateKey,
  });

  // Build GasSponsoredSessionExecutionRequest calldata
  // GasSponsoredSessionExecutionRequest {
  //   execute_after: u64,
  //   execute_before: u64,
  //   allowed_method_guids: Span<felt252>,
  //   spending_limits: Span<TokenAmount>,
  //   calls: Span<Call>,
  //   call_hints: Span<u32>,
  // }

  const gsSessionCalldata = [
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

  console.log("\n=== Executing GasSponsoredSession ===");
  console.log("Caller Address:", callerAddress);
  console.log("Session Caller (expected):", sessionData.sessionCaller);
  console.log("Braavos Account:", sessionData.braavosAccountAddress);
  console.log("\nCalldata being sent:");
  console.log("  execute_after:", sessionData.executeAfter);
  console.log("  execute_before:", sessionData.executeBefore);
  console.log("  allowed_method_guids:", [targetMethod.guid]);
  console.log("  spending_limits:", sessionData.spendingLimits);
  console.log("  calls:", [actualCall]);
  console.log("  call_hints:", [0]);
  console.log("\nSignature:");
  console.log("  r:", sessionData.signature.r);
  console.log("  s:", sessionData.signature.s);

  try {
    const tx = await callerAccount.execute([
      {
        contractAddress: sessionData.braavosAccountAddress,
        entrypoint: "execute_gas_sponsored_session_tx",
        calldata: [...gsSessionCalldata, ...signatureCalldata],
      },
    ]);

    console.log("Tx submitted:", tx.transaction_hash);
    console.log(`View on Starkscan: https://sepolia.starkscan.co/tx/${tx.transaction_hash}`);
    
    const receipt = await provider.waitForTransaction(tx.transaction_hash, {
      retryInterval: 5000,
    });
    const success =
      typeof receipt.isSuccess === "function"
        ? receipt.isSuccess()
        : receipt.isSuccess;
    console.log("Tx status:", success ? "SUCCEEDED" : "FAILED");
    
    if (!success) {
      console.log("\n❌ Transaction failed!");
      console.log("Check the transaction on Starkscan for the revert reason.");
      console.log("\nCommon issues:");
      console.log("1. Session hash mismatch - signature was for a different hash");
      console.log("2. Session expired - check execute_before timestamp");
      console.log("3. Session not started yet - check execute_after timestamp");
      console.log("4. Invalid signature format");
      console.log("5. Caller address mismatch");
    }
  } catch (err: any) {
    console.error("Failed to execute gas-sponsored session:", err?.message ?? err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

