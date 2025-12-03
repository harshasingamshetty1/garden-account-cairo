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

async function verifyHashMatch() {
  console.log("🔍 Verifying Hash Computation Match\n");

  const sessionFile = path.join(path.dirname(config.credsFile), "session.json");
  const sessionInfo = readJsonFile<SessionInfo>(sessionFile);

  console.log(`Session Hash from file: ${sessionInfo.sessionHash}`);
  console.log(`Braavos Account: ${sessionInfo.braavosAccount}`);
  console.log(`Caller: ${sessionInfo.caller}\n`);

  // Recreate the exact TypedData
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
      version: "2", // V1 sessions
      chainId: "0x534e5f5345504f4c4941",
      revision: "1",
    },
    message: {
      Caller: sessionInfo.caller,
      "Execute After": sessionInfo.executeAfter.toString(),
      "Execute Before": sessionInfo.executeBefore.toString(),
      "Allowed Methods": sessionInfo.allowedMethods.map((method) => ({
        "Contract Address": method.contractAddress,
        Selector: method.selector,
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

  // Compute hash using TypedData
  const typedDataHash = typedDataUtils.getMessageHash(
    typedData,
    sessionInfo.braavosAccount,
  );

  console.log(`TypedData Hash:     ${typedDataHash}`);
  console.log(
    `Match: ${typedDataHash === sessionInfo.sessionHash ? "✅" : "❌"}\n`,
  );

  if (typedDataHash !== sessionInfo.sessionHash) {
    console.log(
      "❌ MISMATCH! The TypedData hash doesn't match the stored session hash.",
    );
    console.log(
      "This means the session was created with different parameters.\n",
    );
  }

  // Now compute what the CONTRACT would compute from the GUIDs we pass
  console.log("Computing hash as the contract would during validation...\n");

  // Compute GUIDs for V1
  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
  );

  const guids = sessionInfo.allowedMethods.map((method) =>
    hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH,
      method.contractAddress,
      method.selector,
    ]),
  );

  console.log("GUIDs:");
  guids.forEach((guid, i) => console.log(`  ${i + 1}. ${guid}`));

  // The contract does: calculate_gas_sponsored_session_execution_hash
  // which calls hash_gas_sponsored_session_execution
  // Let me replicate that exactly

  const GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH = hash.getSelectorFromName(
    '"GasSponsoredSessionExecution"("Caller":"ContractAddress","Execute After":"timestamp","Execute Before":"timestamp","Allowed Methods":"AllowedMethod*","Spending Limits":"TokenAmount*")"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
  );

  // hash_allowed_methods_guids (line 135-137 in hash.cairo)
  const guidsHash = hash.computePoseidonHashOnElements(guids);
  console.log(`\nGUIDs Hash: ${guidsHash}`);

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

  // hash_gas_sponsored_session_execution (line 85-101) for V1
  const messageHash = hash.computePoseidonHashOnElements([
    GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH,
    sessionInfo.caller,
    sessionInfo.executeAfter.toString(),
    sessionInfo.executeBefore.toString(),
    guidsHash,
    spendingLimitsHash,
  ]);

  console.log(`\nMessage Hash (from GUIDs): ${messageHash}`);

  // Now wrap with SNIP-12
  const STARKNET_DOMAIN_TYPE_HASH = hash.getSelectorFromName(
    '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
  );

  const domainHash = hash.computePoseidonHashOnElements([
    STARKNET_DOMAIN_TYPE_HASH,
    hash.getSelectorFromName("Account.execute_gs_session"),
    "2", // version (V1 uses version 2)
    "0x534e5f5345504f4c4941", // chainId
    "1", // revision
  ]);

  console.log(`Domain Hash: ${domainHash}`);

  const snip12Hash = hash.computePoseidonHashOnElements([
    hash.getSelectorFromName("StarkNet Message"),
    domainHash,
    sessionInfo.braavosAccount,
    messageHash,
  ]);

  console.log(`\nFinal SNIP-12 Hash (manual): ${snip12Hash}`);
  console.log(`TypedData Hash:              ${typedDataHash}`);
  console.log(`Session Hash from file:      ${sessionInfo.sessionHash}`);
  console.log(
    `\nManual == TypedData: ${snip12Hash === typedDataHash ? "✅" : "❌"}`,
  );
  console.log(
    `Manual == File:      ${snip12Hash === sessionInfo.sessionHash ? "✅" : "❌"}`,
  );
}

verifyHashMatch().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
