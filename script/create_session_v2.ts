#!/usr/bin/env node
/**
 * create_session_v2.ts
 *
 * Creates a V2 GasSponsoredSession with CALLDATA VALIDATION.
 * This restricts the `transfer` function to only allow amount = 1 STRK (1e18).
 *
 * The V2 session includes:
 * - Calldata validations: Validates specific parameter values
 * - Spending limits: Total cumulative budget (9 STRK)
 *
 * Usage:
 *   npx ts-node script/create_session_v2.ts
 *
 * Env (required):
 *   BRAAVOS_ACCOUNT_ADDRESS      - The Braavos account granting the session
 *   BRAAVOS_ACCOUNT_PRIVATE_KEY  - Stark private key of the Braavos account owner
 *   DEPLOYER_ADDRESS             - Address of the session caller (who will execute)
 *   TARGET_CONTRACT              - Contract address (e.g., STRK token)
 */

import { Account, RpcProvider, ec, hash, num, shortString, typedData } from "starknet";
import type { TypedData } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const configDir = path.join(process.cwd(), "script");
dotenv.config({ path: path.join(configDir, ".env") });

const SCRIPT_DIR = path.resolve(process.cwd(), "script");

type NetworkType = "sepolia" | "mainnet" | "devnet";

// 10 years in seconds
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

// 1 STRK = 1e18
const ONE_STRK = 1000000000000000000n;
// 9 STRK = 9e18 (spending limit)
const NINE_STRK = 9n * ONE_STRK;

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function splitU256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  return {
    low: value & mask,
    high: value >> 128n,
  };
}

/**
 * Build SNIP-12 TypedData for GasSponsoredSessionExecution V2
 * V2 includes CalldataValidations in AllowedMethod
 */
function buildGasSponsoredSessionTypedDataV2(params: {
  chainId: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    calldataValidations: Array<{ offset: number; value: string; validationType: number }>;
  }>;
  spendingLimits: Array<{ tokenAddress: string; amount: bigint }>;
}): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      GasSponsoredSessionExecution: [
        { name: "Caller", type: "ContractAddress" },
        { name: "Execute After", type: "timestamp" },
        { name: "Execute Before", type: "timestamp" },
        { name: "Allowed Methods", type: "AllowedMethod*" },
        { name: "Spending Limits", type: "TokenAmount*" },
      ],
      AllowedMethod: [
        { name: "Contract Address", type: "ContractAddress" },
        { name: "Selector", type: "selector" },
        { name: "Calldata Validations", type: "CalldataValidation*" },
      ],
      CalldataValidation: [
        { name: "Offset", type: "u128" },
        { name: "Value", type: "felt" },
        { name: "Validation Type", type: "u128" },
      ],
      TokenAmount: [
        { name: "token_address", type: "ContractAddress" },
        { name: "amount", type: "u256" },
      ],
      u256: [
        { name: "low", type: "u128" },
        { name: "high", type: "u128" },
      ],
    },
    primaryType: "GasSponsoredSessionExecution",
    domain: {
      name: "Account.execute_gs_session",
      version: "3",  // V2 uses version 3
      chainId: params.chainId,
      revision: "1",
    },
    message: {
      Caller: params.caller,
      "Execute After": params.executeAfter,
      "Execute Before": params.executeBefore,
      "Allowed Methods": params.allowedMethods.map((m) => ({
        "Contract Address": m.contractAddress,
        Selector: m.selector.startsWith("0x")
          ? m.selector
          : hash.getSelectorFromName(m.selector),
        "Calldata Validations": m.calldataValidations.map((cv) => ({
          Offset: cv.offset,
          Value: cv.value,
          "Validation Type": cv.validationType,
        })),
      })),
      "Spending Limits": params.spendingLimits.map((l) => {
        const { low, high } = splitU256(l.amount);
        return {
          token_address: l.tokenAddress,
          amount: {
            low: Number(low),
            high: Number(high),
          },
        };
      }),
    },
  };
}

/**
 * Compute allowed method GUID for V2 (includes calldata validations)
 */
function computeAllowedMethodGuidV2(
  contractAddress: string,
  selector: string,
  calldataValidations: Array<{ offset: number; value: string; validationType: number }>,
): string {
  const selectorHex = selector.startsWith("0x")
    ? selector
    : hash.getSelectorFromName(selector);

  // V2 AllowedMethod type hash
  const ALLOWED_METHOD_TYPE_HASH_V2 = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  // Hash calldata validations
  const CALLDATA_VALIDATION_TYPE_HASH = hash.getSelectorFromName(
    '"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  const hashedValidations = calldataValidations.map((cv) =>
    hash.computePoseidonHashOnElements([
      CALLDATA_VALIDATION_TYPE_HASH,
      cv.offset.toString(),
      cv.value,
      cv.validationType.toString(),
    ]),
  );

  const calldataValidationsHash = hash.computePoseidonHashOnElements(hashedValidations);

  return hash.computePoseidonHashOnElements([
    ALLOWED_METHOD_TYPE_HASH_V2,
    contractAddress,
    selectorHex,
    calldataValidationsHash,
  ]);
}

async function main() {
  const args = process.argv.slice(2);

  let network: NetworkType = "sepolia";
  let rpcUrl = process.env.STARKNET_NODE_URL;

  if (args.length === 2) {
    network = args[0] as NetworkType;
    rpcUrl = args[1];
  }

  if (!["sepolia", "mainnet", "devnet"].includes(network)) {
    console.error("Invalid network. Supported: sepolia, mainnet, devnet");
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // Read Braavos account credentials from env
  const braavosAddress = process.env.BRAAVOS_ACCOUNT_ADDRESS;
  const braavosPrivateKey = process.env.BRAAVOS_ACCOUNT_PRIVATE_KEY;

  if (!braavosAddress || !braavosPrivateKey) {
    console.error("Missing BRAAVOS_ACCOUNT_ADDRESS or BRAAVOS_ACCOUNT_PRIVATE_KEY in env");
    process.exit(1);
  }

  console.log(`\n🔐 Braavos Account (granting session): ${braavosAddress}`);

  const sessionCaller = process.env.SESSION_CALLER_ADDRESS ?? process.env.DEPLOYER_ADDRESS;
  if (!sessionCaller) {
    console.error("Missing SESSION_CALLER_ADDRESS or DEPLOYER_ADDRESS in env");
    process.exit(1);
  }
  console.log(`📄 Session Caller (authorized to execute): ${sessionCaller}`);

  const targetContract = process.env.TARGET_CONTRACT;
  const targetSelector = process.env.TARGET_SELECTOR ?? "transfer";

  if (!targetContract) {
    console.error("Missing TARGET_CONTRACT in env");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const executeAfter = Number(process.env.EXECUTE_AFTER ?? now - 3600);
  const executeBefore = Number(process.env.EXECUTE_BEFORE ?? now + TEN_YEARS_SECONDS);

  // Get chain ID
  const chainId = await provider.getChainId();

  // ============================================================================
  // V2 Session with Calldata Validation
  // For transfer(to, amount): calldata = [to, amount.low, amount.high]
  // We validate that amount = exactly 1 STRK (1e18)
  // ============================================================================

  const { low: amountLow, high: amountHigh } = splitU256(ONE_STRK);

  // Calldata validations: restrict amount to exactly 1 STRK
  const calldataValidations = [
    { offset: 1, value: toHex(amountLow), validationType: 0 },   // amount.low = 1e18
    { offset: 2, value: toHex(amountHigh), validationType: 0 },  // amount.high = 0
  ];

  // Spending limit: 9 STRK total budget
  const spendingLimits = [
    { tokenAddress: targetContract, amount: NINE_STRK },
  ];

  // Build TypedData for V2
  const sessionTypedData = buildGasSponsoredSessionTypedDataV2({
    chainId,
    caller: sessionCaller,
    executeAfter,
    executeBefore,
    allowedMethods: [
      {
        contractAddress: targetContract,
        selector: targetSelector,
        calldataValidations,
      },
    ],
    spendingLimits,
  });

  // Compute allowed method GUID for V2
  const allowedMethodGuid = computeAllowedMethodGuidV2(
    targetContract,
    targetSelector,
    calldataValidations,
  );

  console.log("\n=== V2 Session Configuration ===");
  console.log(`Network: ${network}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Braavos Account: ${braavosAddress}`);
  console.log(`Session Caller: ${sessionCaller}`);
  console.log(`Target Contract: ${targetContract}`);
  console.log(`Target Selector: ${targetSelector}`);
  console.log(`\n📋 Calldata Validations:`);
  calldataValidations.forEach((cv, i) => {
    console.log(`  [${i}] offset=${cv.offset}, value=${cv.value}, type=Eq`);
  });
  console.log(`\n💰 Spending Limits:`);
  console.log(`  Token: ${targetContract}`);
  console.log(`  Max Total: ${NINE_STRK.toString()} (9 STRK)`);
  console.log(`\n✅ Amount per tx restricted to: ${ONE_STRK.toString()} (1 STRK)`);
  console.log(`\nAllowed Method GUID (V2): ${allowedMethodGuid}`);
  console.log(`Execute After: ${executeAfter}`);
  console.log(`Execute Before: ${executeBefore}`);
  console.log(`Chain ID: ${chainId}`);

  const sessionType = "GasSponsoredSessionV2";
  console.log(`\nSession Type: ${sessionType}`);

  // Compute session hash using SNIP-12 TypedData
  const sessionHash = typedData.getMessageHash(sessionTypedData, braavosAddress);
  console.log(`Session Hash: ${sessionHash}`);

  // Sign with Braavos owner's key
  const signature = ec.starkCurve.sign(sessionHash, braavosPrivateKey);
  const signatureR = toHex(signature.r);
  const signatureS = toHex(signature.s);

  console.log(`\nSignature:`);
  console.log(`  r: ${signatureR}`);
  console.log(`  s: ${signatureS}`);

  // Build session JSON
  const selectorHex = targetSelector.startsWith("0x")
    ? targetSelector
    : hash.getSelectorFromName(targetSelector);

  const sessionCallerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";

  const sessionData = {
    sessionType,
    sessionVersion: "V2",
    braavosAccountAddress: braavosAddress,
    chainId,
    sessionHash,
    executeAfter: executeAfter.toString(),
    executeBefore: executeBefore.toString(),
    sessionCaller,
    sessionCallerPrivateKey,
    allowedMethods: [
      {
        contractAddress: targetContract,
        selector: targetSelector,
        selectorHex,
        guid: allowedMethodGuid,
        calldataValidations: calldataValidations.map((cv) => ({
          offset: cv.offset,
          value: cv.value,
          validationType: cv.validationType,
        })),
      },
    ],
    spendingLimits: spendingLimits.map((l) => ({
      tokenAddress: l.tokenAddress,
      amount: l.amount.toString(),
    })),
    // Restricted amount for easy reference
    restrictedAmount: ONE_STRK.toString(),
    signature: {
      r: signatureR,
      s: signatureS,
    },
  };

  const outputPath = path.join(SCRIPT_DIR, "session_data_v2.json");
  fs.writeFileSync(outputPath, JSON.stringify(sessionData, null, 2));
  console.log(`\n✅ V2 Session data saved to: ${outputPath}`);

  console.log(`
=== How to test this V2 session ===

1. Transfer 1 STRK (should SUCCEED):
   npx ts-node script/execute_session_1stark.ts

2. Transfer 2 STRK (should FAIL - calldata validation):
   npx ts-node script/execute_session_2stark.ts

The session restricts transfers to EXACTLY 1 STRK per transaction.
Total spending budget is 9 STRK.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

