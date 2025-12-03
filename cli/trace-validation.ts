#!/usr/bin/env node
import { readJsonFile } from "./helpers/file";
import { hash } from "starknet";
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

async function traceValidation() {
  console.log("🔍 Tracing Contract Validation Flow\n");

  const sessionFile = path.join(path.dirname(config.credsFile), "session.json");
  const sessionInfo = readJsonFile<SessionInfo>(sessionFile);

  console.log("📋 Session Info:");
  console.log(`   Braavos Account: ${sessionInfo.braavosAccount}`);
  console.log(`   Caller: ${sessionInfo.caller}`);
  console.log(`   Stored Session Hash: ${sessionInfo.sessionHash}\n`);

  // Step 1: Contract receives GUIDs in calldata
  console.log("Step 1: Contract receives these GUIDs in calldata:");

  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
  );

  const guids = sessionInfo.allowedMethods.map((method, i) => {
    const guid = hash.computePoseidonHashOnElements([
      ALLOWED_METHOD_TYPE_HASH,
      method.contractAddress,
      method.selector,
    ]);
    console.log(`   GUID ${i + 1}: ${guid}`);
    return guid;
  });

  // Step 2: Contract hashes the GUIDs (hash_allowed_methods_guids)
  console.log("\nStep 2: Contract hashes GUIDs:");
  const guidsHash = hash.computePoseidonHashOnElements(guids);
  console.log(`   poseidon_hash(guids) = ${guidsHash}`);

  // Step 3: Contract hashes spending limits
  console.log("\nStep 3: Contract hashes spending limits:");

  const U256_TYPE_HASH = hash.getSelectorFromName(
    '"u256"("low":"u128","high":"u128")',
  );
  const TOKEN_AMOUNT_TYPE_HASH = hash.getSelectorFromName(
    '"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
  );

  const spendingLimitHashes = sessionInfo.spendingLimits.map((limit, i) => {
    const amountHash = hash.computePoseidonHashOnElements([
      U256_TYPE_HASH,
      limit.amount.low,
      limit.amount.high,
    ]);
    const limitHash = hash.computePoseidonHashOnElements([
      TOKEN_AMOUNT_TYPE_HASH,
      limit.tokenAddress,
      amountHash,
    ]);
    console.log(`   Limit ${i + 1} hash: ${limitHash}`);
    return limitHash;
  });

  const spendingLimitsHash =
    hash.computePoseidonHashOnElements(spendingLimitHashes);
  console.log(`   poseidon_hash(limit_hashes) = ${spendingLimitsHash}`);

  // Step 4: Contract computes message hash
  console.log("\nStep 4: Contract computes message hash:");

  const GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH = hash.getSelectorFromName(
    '"GasSponsoredSessionExecution"("Caller":"ContractAddress","Execute After":"timestamp","Execute Before":"timestamp","Allowed Methods":"AllowedMethod*","Spending Limits":"TokenAmount*")"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
  );

  const messageHash = hash.computePoseidonHashOnElements([
    GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH,
    sessionInfo.caller,
    sessionInfo.executeAfter.toString(),
    sessionInfo.executeBefore.toString(),
    guidsHash,
    spendingLimitsHash,
  ]);

  console.log(`   Type Hash: ${GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH}`);
  console.log(`   Message Hash: ${messageHash}`);

  // Step 5: Contract wraps with SNIP-12
  console.log("\nStep 5: Contract wraps with SNIP-12:");

  const STARKNET_DOMAIN_TYPE_HASH = hash.getSelectorFromName(
    '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
  );

  const domainHash = hash.computePoseidonHashOnElements([
    STARKNET_DOMAIN_TYPE_HASH,
    hash.getSelectorFromName("Account.execute_gs_session"),
    "2", // version
    "0x534e5f5345504f4c4941", // chainId
    "1", // revision
  ]);

  console.log(`   Domain Hash: ${domainHash}`);

  const finalHash = hash.computePoseidonHashOnElements([
    hash.getSelectorFromName("StarkNet Message"),
    domainHash,
    sessionInfo.braavosAccount,
    messageHash,
  ]);

  console.log(`   Final Hash: ${finalHash}`);

  console.log("\n📊 Comparison:");
  console.log(`   Contract-computed Hash: ${finalHash}`);
  console.log(`   Stored Session Hash:    ${sessionInfo.sessionHash}`);
  console.log(
    `   Match: ${finalHash === sessionInfo.sessionHash ? "✅" : "❌"}`,
  );

  if (finalHash !== sessionInfo.sessionHash) {
    console.log(
      "\n❌ MISMATCH! The contract will compute a different hash than what we signed.",
    );
    console.log("   This is why INVALID_SIG occurs.");
    console.log("\n🔍 Possible issues:");
    console.log("   1. Type hash strings don't match exactly");
    console.log("   2. Field encoding order is different");
    console.log("   3. Array encoding method is different");
  } else {
    console.log("\n✅ Hashes match! The issue must be elsewhere.");
  }
}

traceValidation().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
