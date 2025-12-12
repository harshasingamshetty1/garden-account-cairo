#!/usr/bin/env node
/**
 * create_session.ts
 * 
 * Creates and signs a gas-sponsored session using Ledger.
 * Saves the session data to a JSON file for later execution.
 * 
 * Uses starknet.js TypedData for proper SNIP-12 hashing.
 */
import { RpcProvider, hash, LedgerSigner231, typedData, TypedData } from "starknet";
import * as TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), "script", ".env") });

import {
  CalldataValidationType,
  MAX_UINT256,
} from "../cli/helpers/session_v2";

function getAllowedMethodGuidV2({
  contractAddress,
  selector,
  calldataValidations,
}: {
  contractAddress: string;
  selector: string;
  calldataValidations: Array<{
    offset: number;
    value: string;
    validation_type: number;
  }>;
}): string {
  const ALLOWED_METHOD_TYPE_HASH_V2 = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")' +
    '"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );
  
  const CALLDATA_VALIDATION_TYPE_HASH = hash.getSelectorFromName(
    '"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  const validationHashes = calldataValidations.map((v) =>
    hash.computePoseidonHashOnElements([
      CALLDATA_VALIDATION_TYPE_HASH,
      v.offset.toString(),
      v.value,
      v.validation_type.toString(),
    ]),
  );

  const validationsHash = hash.computePoseidonHashOnElements(validationHashes);

  return hash.computePoseidonHashOnElements([
    ALLOWED_METHOD_TYPE_HASH_V2,
    contractAddress,
    selector,
    validationsHash,
  ]);
}

function splitU256(value: bigint): { low: string; high: string } {
  const mask = (1n << 128n) - 1n;
  return {
    low: (value & mask).toString(),
    high: (value >> 128n).toString(),
  };
}

function buildTypedData(params: {
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
      version: "3",
      chainId: params.chainId,
      revision: "1",
    },
    message: {
      Caller: params.caller,
      "Execute After": params.executeAfter,
      "Execute Before": params.executeBefore,
      "Allowed Methods": params.allowedMethods.map((m) => ({
        "Contract Address": m.contractAddress,
        Selector: m.selector,
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
          amount: { low, high },
        };
      }),
    },
  };
}

async function main() {
  const nodeUrl = process.env.STARKNET_NODE_URL;
  const chainIdEnv = process.env.CHAIN_ID;
  const braavosAccount = process.env.ACCOUNT_ADDRESS;
  const deployerAddress = process.env.DEPLOYER_ADDRESS;
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const targetAddress = process.env.TARGET_ADDRESS;

  const executeAfterOffset = Number(process.env.EXECUTE_AFTER_OFFSET || "60");
  const executeBeforeDuration = Number(
    process.env.EXECUTE_BEFORE_DURATION || 24 * 60 * 60,
  );

  const required = {
    ACCOUNT_ADDRESS: braavosAccount,
    DEPLOYER_ADDRESS: deployerAddress,
    TOKEN_ADDRESS: tokenAddress,
    TARGET_ADDRESS: targetAddress,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const acctAddr = braavosAccount!;
  const callerAddr = deployerAddress!;
  const tokenAddr = tokenAddress!;
  const tgtAddr = targetAddress!;

  const provider = nodeUrl ? new RpcProvider({ nodeUrl }) : new RpcProvider();

  const now = Math.floor(Date.now() / 1000);
  const executeAfter = now - executeAfterOffset;
  const executeBefore = now + executeBeforeDuration;

  const transferSelector = hash.getSelectorFromName("transfer");

  // Calldata validations: restrict recipient to target address
  const calldataValidations = [
    [
      {
        offset: 0,
        value: tgtAddr,
        validation_type: CalldataValidationType.Eq,
      },
    ],
  ];

  // Spending limit: MAX_UINT256
  const MAX_U256 = (1n << 256n) - 1n;
  const spendingLimits = [
    {
      tokenAddress: tokenAddr,
      amount: MAX_U256,
    },
  ];

  const chainId = chainIdEnv ?? (await provider.getChainId());

  console.log("\n📋 Session Parameters:");
  console.log(`   Braavos Account: ${acctAddr}`);
  console.log(`   Session Caller: ${callerAddr}`);
  console.log(`   Token Address: ${tokenAddr}`);
  console.log(`   Target Address: ${tgtAddr}`);
  console.log(`   Chain ID: ${chainId}`);
  console.log(`   Execute After: ${executeAfter}`);
  console.log(`   Execute Before: ${executeBefore}`);

  // Compute allowed method GUID
  const allowedMethodGuids = [
    getAllowedMethodGuidV2({
      contractAddress: tokenAddr,
      selector: transferSelector.toString(),
      calldataValidations: calldataValidations[0],
    }),
  ];

  console.log(`   Allowed Method GUID: ${allowedMethodGuids[0]}`);

  // Build TypedData for SNIP-12 signing
  const sessionTypedData = buildTypedData({
    chainId,
    caller: callerAddr,
    executeAfter,
    executeBefore,
    allowedMethods: [
      {
        contractAddress: tokenAddr,
        selector: transferSelector.toString(),
        calldataValidations: calldataValidations[0].map(v => ({
          offset: v.offset,
          value: v.value,
          validationType: v.validation_type,
        })),
      },
    ],
    spendingLimits,
  });

  // Use starknet.js to compute the SNIP-12 message hash
  const sessionHash = typedData.getMessageHash(sessionTypedData, acctAddr);
  console.log("\n🔐 Computed session hash (SNIP-12):", sessionHash);

  // Connect to Ledger
  console.log("\n🔌 Connecting to Ledger device...");
  const transport = await TransportNodeHid.default.create();
  if (!transport) {
    throw new Error("Failed to connect to Ledger device");
  }
  console.log("✅ Ledger connected");

  const ledgerSigner = new LedgerSigner231(transport, 0);

  console.log("\n🔑 Fetching Ledger Stark public key...");
  const ledgerPubKey = await ledgerSigner.getPubKey();
  console.log(`   Public Key: ${ledgerPubKey}`);

  console.log("\n✍️  Please approve the signature on your Ledger device...");
  const sig = await ledgerSigner.signRaw(sessionHash);
  
  console.log("✅ Signature obtained from Ledger");
  console.log(`   r: ${sig.r.toString()}`);
  console.log(`   s: ${sig.s.toString()}`);

  await transport.close();
  console.log("✅ Ledger connection closed");

  // Save session data
  const { low: amountLow, high: amountHigh } = splitU256(MAX_U256);
  
  const sessionData = {
    sessionHash,
    braavosAccountAddress: acctAddr,
    sessionCaller: callerAddr,
    tokenAddress: tokenAddr,
    targetAddress: tgtAddr,
    chainId,
    executeAfter,
    executeBefore,
    allowedMethodGuids,
    spendingLimits: [{
      tokenAddress: tokenAddr,
      amount: { low: amountLow, high: amountHigh }
    }],
    calldataValidations,
    signature: {
      r: sig.r.toString(),
      s: sig.s.toString(),
    },
    ledgerPublicKey: ledgerPubKey,
    createdAt: new Date().toISOString(),
  };

  const outputPath = path.join(process.cwd(), "script", "session_data.json");
  fs.writeFileSync(outputPath, JSON.stringify(sessionData, null, 2));
  
  console.log(`\n✅ Session data saved to: ${outputPath}`);
  console.log("\n📝 Next step: Run 'tsx script/execute_session.ts' to execute the transfer");
}

main().catch(async (err) => {
  console.error("❌ Failed to create session:", err);
  process.exit(1);
});
