#!/usr/bin/env node
import { readJsonFile } from "./helpers/file";
import { TypedData, typedData as typedDataUtils, hash } from "starknet";
import path from "path";
import { config } from "./config";

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

async function computeGuidsFromSession() {
  console.log("🔍 Computing GUIDs from Session TypedData\n");

  const sessionFile = path.join(path.dirname(config.credsFile), "session.json");
  const sessionInfo = readJsonFile<SessionInfo>(sessionFile);

  // Recreate the exact TypedData used to create the session
  const typedData: TypedData = {
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
      chainId: "0x534e5f5345504f4c4941", // Sepolia
      revision: "1",
    },
    message: {
      Caller: sessionInfo.caller,
      "Execute After": sessionInfo.executeAfter.toString(),
      "Execute Before": sessionInfo.executeBefore.toString(),
      "Allowed Methods": sessionInfo.allowedMethods.map((method) => ({
        "Contract Address": method.contractAddress,
        Selector: method.selector,
        "Calldata Validations": [],
      })),
      "Spending Limits": sessionInfo.spendingLimits.map((limit) => ({
        token_address: limit.tokenAddress,
        amount: {
          low: limit.amount.low,
          high: limit.amount.high,
        },
      })),
    },
  };

  // Try to use TypedData to encode each AllowedMethod
  console.log("Attempting to compute GUIDs using TypedData encoding...\n");

  // For now, let's manually compute using the structure hash approach
  // The GUID should be the struct hash of AllowedMethod
  const ALLOWED_METHOD_TYPE_HASH_V2 = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  console.log(`ALLOWED_METHOD_TYPE_HASH_V2: ${ALLOWED_METHOD_TYPE_HASH_V2}`);

  // Empty calldata validations array hash
  const emptyArrayHash = hash.computePoseidonHashOnElements([]);
  console.log(`Empty array hash: ${emptyArrayHash}`);

  sessionInfo.allowedMethods.forEach((method, i) => {
    const guid = hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH_V2,
      method.contractAddress,
      method.selector,
      emptyArrayHash,
    ]);

    console.log(`\nMethod ${i + 1}:`);
    console.log(`  Contract: ${method.contractAddress}`);
    console.log(`  Selector: ${method.selector}`);
    console.log(`  GUID: ${guid}`);
  });

  // Now compute the full session hash manually
  const GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH_V2 = hash.getSelectorFromName(
    '"GasSponsoredSessionExecution"("Caller":"ContractAddress","Execute After":"timestamp","Execute Before":"timestamp","Allowed Methods":"AllowedMethod*","Spending Limits":"TokenAmount*")"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
  );

  console.log(
    `\n\nGAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH_V2: ${GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH_V2}`,
  );

  // Compute allowed methods hash (hash of GUIDs)
  const guids = sessionInfo.allowedMethods.map((method) =>
    hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH_V2,
      method.contractAddress,
      method.selector,
      emptyArrayHash,
    ]),
  );

  const allowedMethodsHash = hash.computePoseidonHashOnElements(guids);
  console.log(`\nAllowed Methods Hash (hash of GUIDs): ${allowedMethodsHash}`);

  // Compute spending limits hash
  const TOKEN_AMOUNT_TYPE_HASH = hash.getSelectorFromName(
    '"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
  );
  const U256_TYPE_HASH = hash.getSelectorFromName(
    '"u256"("low":"u128","high":"u128")',
  );

  const spendingLimitHashes = sessionInfo.spendingLimits.map((limit) => {
    const amountHash = hash.computePoseidonHashOnElements([
      U256_TYPE_HASH,
      limit.amount.low,
      limit.amount.high,
    ]);
    return hash.computePoseidonHashOnElements([
      TOKEN_AMOUNT_TYPE_HASH,
      limit.tokenAddress,
      amountHash,
    ]);
  });

  const spendingLimitsHash =
    hash.computePoseidonHashOnElements(spendingLimitHashes);
  console.log(`Spending Limits Hash: ${spendingLimitsHash}`);

  // Compute message hash
  const messageHash = hash.computePoseidonHashOnElements([
    GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH_V2,
    sessionInfo.caller,
    sessionInfo.executeAfter.toString(),
    sessionInfo.executeBefore.toString(),
    allowedMethodsHash,
    spendingLimitsHash,
  ]);

  console.log(`\nComputed Message Hash: ${messageHash}`);

  // Compute the full TypedData hash
  const typedDataMessageHash = typedDataUtils.getMessageHash(
    typedData,
    sessionInfo.braavosAccount,
  );

  console.log(`\nTypedData Message Hash: ${typedDataMessageHash}`);
  console.log(`Session Hash from file: ${sessionInfo.sessionHash}`);
  console.log(
    `TypedData matches file: ${typedDataMessageHash === sessionInfo.sessionHash ? "✅" : "❌"}`,
  );
}

computeGuidsFromSession().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
