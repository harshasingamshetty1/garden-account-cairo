#!/usr/bin/env node
import { Account, Call, RpcProvider, hash, LedgerSigner231, Signature } from "starknet";
import * as TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
// import dotenv from "dotenv";
import path from "node:path";
// dotenv.config({ path: path.join(process.cwd(), ".env") });
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createGasSponsoredSessionTypedDataV2,
  CalldataValidationType,
  MAX_UINT256,
} from "../cli/helpers/session_v2";
import {
  calculateSessionHash,
  splitUint128,
  toFelt,
} from "../cli/helpers/numeric";

dotenv.config({ path: path.join(process.cwd(), ".env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function toUint128Strings(value: bigint): [string, string] {
  const [low, high] = splitUint128(value);
  return [low.toString(), high.toString()];
}

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
  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation**")',
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

  // Matches hash_calldata_validations in Cairo (poseidon_hash_span)
  const validationsHash =
    validationHashes.length > 0
      ? hash.computePoseidonHashOnElements([
          validationHashes.length.toString(),
          ...validationHashes,
        ])
      : hash.computePoseidonHashOnElements([
          validationHashes.length.toString(),
        ]);

  return hash.computePoseidonHashOnElements([
    ALLOWED_METHOD_TYPE_HASH,
    contractAddress,
    selector,
    validationsHash,
  ]);
}

function buildCalldataV2(params: {
  executeAfter: number;
  executeBefore: number;
  allowedMethodGuids: string[];
  spendingLimits: Array<{ tokenAddress: string; amount: { low: string; high: string } }>;
  calldataValidations: Array<
    Array<{ offset: number; value: string; validation_type: number }>
  >;
  calls: Call[];
  callHints: number[];
  signature: string[];
}): string[] {
  const {
    executeAfter,
    executeBefore,
    allowedMethodGuids,
    spendingLimits,
    calldataValidations,
    calls,
    callHints,
    signature,
  } = params;

  const calldata: string[] = [];

  calldata.push(executeAfter.toString());
  calldata.push(executeBefore.toString());

  calldata.push(allowedMethodGuids.length.toString());
  calldata.push(...allowedMethodGuids);

  calldata.push(spendingLimits.length.toString());
  for (const limit of spendingLimits) {
    calldata.push(limit.tokenAddress);
    calldata.push(limit.amount.low);
    calldata.push(limit.amount.high);
  }

  // Calldata validations span
  calldata.push(calldataValidations.length.toString());
  for (const validations of calldataValidations) {
    calldata.push(validations.length.toString());
    for (const v of validations) {
      calldata.push(v.offset.toString());
      calldata.push(v.value);
      calldata.push(v.validation_type.toString());
    }
  }

  // Calls span
  calldata.push(calls.length.toString());
  for (const call of calls) {
    calldata.push(call.contractAddress);
    calldata.push(
      call.entrypoint ? hash.getSelectorFromName(call.entrypoint) : "0",
    );
    const callCalldata = Array.isArray(call.calldata) ? call.calldata : [];
    calldata.push(callCalldata.length.toString());
    calldata.push(...callCalldata.map((c) => c.toString()));
  }

  // Call hints span
  calldata.push(callHints.length.toString());
  calldata.push(...callHints.map((h) => h.toString()));

  // Signature span
  calldata.push(signature.length.toString());
  calldata.push(...signature);

  return calldata;
}

async function main() {
  // Use process.env directly; fail gracefully if critical env is missing
  const nodeUrl = process.env.STARKNET_NODE_URL;
  const chainIdEnv = process.env.CHAIN_ID;
  const braavosAccount = process.env.ACCOUNT_ADDRESS;
  const deployerAddress = process.env.DEPLOYER_ADDRESS;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const targetAddress = process.env.TARGET_ADDRESS;
  const transferAmount =
    process.env.TRANSFER_AMOUNT || MAX_UINT256.LOW; // raw amount, no decimals handling here

  const executeAfterOffset = Number(process.env.EXECUTE_AFTER_OFFSET || "60"); // seconds before now
  const executeBeforeDuration = Number(
    process.env.EXECUTE_BEFORE_DURATION || 24 * 60 * 60,
  );

  // Guard against missing required values to avoid undefined.toLowerCase
  const required = {
    ACCOUNT_ADDRESS: braavosAccount,
    DEPLOYER_ADDRESS: deployerAddress,
    DEPLOYER_PRIVATE_KEY: deployerPrivateKey,
    TOKEN_ADDRESS: tokenAddress,
    TARGET_ADDRESS: targetAddress,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(
      `Missing required env vars: ${missing.join(", ")}. Please set them in .env`,
    );
    process.exit(1);
  }

  const acctAddr = braavosAccount!;
  const callerAddr = deployerAddress!;
  const tokenAddr = tokenAddress!;
  const tgtAddr = targetAddress!;

  const provider = nodeUrl
    ? new RpcProvider({ nodeUrl })
    : new RpcProvider(); // falls back to default public node
  const deployer = new Account({
    provider,
    address: callerAddr,
    signer: deployerPrivateKey!,
  });

  const now = Math.floor(Date.now() / 1000);
  const executeAfter = now - executeAfterOffset;
  const executeBefore = now + executeBeforeDuration;

  const transferSelector = hash.getSelectorFromName("transfer");

  // Restrict transfer recipient to the target address via calldata validation on offset 0
  const calldataValidations = [
    [
      {
        offset: 0, // first calldata item of transfer = recipient
        value: tgtAddr,
        validation_type: CalldataValidationType.Eq,
      },
    ],
  ];

  const allowedMethods = [
    {
      contractAddress: tokenAddr,
      selector: transferSelector.toString(),
    },
  ];

  const spendingLimits = [
    {
      tokenAddress: tokenAddr,
      amount: { low: MAX_UINT256.LOW, high: MAX_UINT256.HIGH },
    },
  ];

  const typedData = createGasSponsoredSessionTypedDataV2({
    accountAddress: acctAddr,
    caller: callerAddr,
    executeAfter,
    executeBefore,
    allowedMethods,
    spendingLimits,
    calldataValidations,
    chainId: chainIdEnv ?? (await provider.getChainId()),
  });

  const sessionHash = calculateSessionHash(typedData, acctAddr);

  // Connect to Ledger and sign with Stark curve (not secp256r1)
  console.log("\n🔌 Connecting to Ledger device...");
  const transport = await TransportNodeHid.default.create();
  if (!transport) {
    throw new Error("Failed to connect to Ledger device");
  }
  console.log("✅ Ledger connected");

  const ledgerSigner = new LedgerSigner231(transport, 0); // derivation path index 0

  // Get Ledger public key
  console.log("\n🔑 Fetching Ledger Stark public key...");
  const ledgerPubKey = await ledgerSigner.getPubKey();
  console.log(`   Public Key: ${ledgerPubKey}`);

  // Sign the session hash using Ledger (Stark curve signature)
  console.log("\n✍️  Please approve the signature on your Ledger device...");
  console.log(`   Session Hash: ${sessionHash}`);
  const sig: Signature = await ledgerSigner.signRaw(sessionHash);
  
  console.log("✅ Signature obtained from Ledger");
  console.log(`   Signature:`, sig);

  const r = sig.r;
  const s = sig.s;
  const [rLow, rHigh] = toUint128Strings(r);
  const [sLow, sHigh] = toUint128Strings(s);

  // For Stark signer (type 1), signature format is different
  const signature = [
    // signer type: Stark = 1 (Ledger uses Stark curve, not secp256r1)
    "1",
    ledgerPubKey, // Stark public key from Ledger
    rLow,
    rHigh,
    sLow,
    sHigh,
  ];

  const allowedMethodGuids = [
    getAllowedMethodGuidV2({
      contractAddress: tokenAddr,
      selector: transferSelector.toString(),
      calldataValidations: calldataValidations[0],
    }),
  ];

  const calls: Call[] = [
    {
      contractAddress: tokenAddr,
      entrypoint: "transfer",
      calldata: [tgtAddr, transferAmount],
    },
  ];

  const calldata = buildCalldataV2({
    executeAfter,
    executeBefore,
    allowedMethodGuids,
    spendingLimits,
    calldataValidations,
    calls,
    callHints: [0],
    signature,
  });

  console.log("🔐 Session hash:", sessionHash);
  console.log("🧾 Calldata built for execute_gas_sponsored_session_tx_v2");
  console.log("➡️  Submitting transaction from deployer...");

  const { transaction_hash } = await deployer.execute({
    contractAddress: acctAddr,
    entrypoint: "execute_gas_sponsored_session_tx_v2",
    calldata,
  });

  console.log("✅ Submitted!");
  console.log("   Tx hash:", transaction_hash);
  console.log("   Caller (gas sponsor):", callerAddr);
  console.log("   Token:", tokenAddr);
  console.log("   Target:", tgtAddr);
  console.log("   Amount:", transferAmount);

  // Close Ledger connection
  await transport.close();
  console.log("\n✅ Ledger connection closed");
}

main().catch(async (err) => {
  console.error("❌ Failed to create/execute transfer session:", err);
  process.exit(1);
});

