#!/usr/bin/env node
import { readJsonFile } from "./helpers/file";
import { TypedData, typedData as typedDataUtils, hash, encode } from "starknet";
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

async function debugTypedData() {
  console.log("🐛 Debugging TypedData Encoding\n");

  const sessionFile = path.join(path.dirname(config.credsFile), "session.json");
  const sessionInfo = readJsonFile<SessionInfo>(sessionFile);

  // Recreate the TypedData
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
      version: "2",
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

  // Get hash from TypedData
  const typedDataHash = typedDataUtils.getMessageHash(
    typedData,
    sessionInfo.braavosAccount,
  );

  console.log(`TypedData Hash: ${typedDataHash}`);
  console.log(`Stored Hash:    ${sessionInfo.sessionHash}`);
  console.log(
    `Match: ${typedDataHash === sessionInfo.sessionHash ? "✅" : "❌"}\n`,
  );

  // Try to get the encoded message (this might give us insight into how TypedData encodes it)
  try {
    // Unfortunately, starknet.js doesn't expose the intermediate encoding steps
    // But we can try to reverse-engineer by encoding parts manually

    console.log("📊 Manual GUID Computation:");
    const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
      '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
    );
    console.log(`Type Hash: ${ALLOWED_METHOD_TYPE_HASH}`);

    sessionInfo.allowedMethods.forEach((method, i) => {
      const guid = hash.computePoseidonHashOnElements([
        ALLOWED_METHOD_TYPE_HASH,
        method.contractAddress,
        method.selector,
      ]);
      console.log(`Method ${i + 1}: ${guid}`);
    });

    const guids = sessionInfo.allowedMethods.map((method) =>
      hash.computePoseidonHashOnElements([
        ALLOWED_METHOD_TYPE_HASH,
        method.contractAddress,
        method.selector,
      ]),
    );

    const guidsArrayHash = hash.computePoseidonHashOnElements(guids);
    console.log(`\nArray Hash (manual): ${guidsArrayHash}`);

    console.log(
      "\n💡 The key question: Does TypedData's encoding of AllowedMethod array",
    );
    console.log("   match our manual poseidon_hash(guids) computation?");
    console.log("\n   If TypedData uses SNIP-12/EIP-712 encoding, it should:");
    console.log(
      "   1. Hash each AllowedMethod struct: hash(type_hash, field1, field2)",
    );
    console.log(
      "   2. Hash the array of struct hashes: hash(hash1, hash2, hash3)",
    );
    console.log(
      "\n   This is what we're doing manually, so they SHOULD match!",
    );
  } catch (e) {
    console.log("Could not decode:", e);
  }
}

debugTypedData().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
