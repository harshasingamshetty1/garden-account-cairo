#!/usr/bin/env node
import {
  readCreds,
  provider,
  getBravosAccount,
  calculateSessionHash,
} from "./utils";
import { writeJsonFile } from "./helpers/file";
import { TypedData, hash } from "starknet";
import path from "path";
import { config, HTLC_ADDRESS, TOKEN_ADDRESS } from "./config";
import { SessionInfo } from "./types";

interface CreateGasSponsoredSessionTypedDataParams {
  accountAddress: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{ contractAddress: string; selector: string }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  chainId: string;
}

/**
 * Generate typed data for Gas Sponsored Session Execution V2
 */
function createGasSponsoredSessionTypedData(
  params: CreateGasSponsoredSessionTypedDataParams,
): TypedData {
  const {
    caller,
    executeAfter,
    executeBefore,
    allowedMethods,
    spendingLimits,
    chainId,
  } = params;
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
      version: "2", // V1 sessions use version 2
      chainId: chainId,
      revision: "1",
    },
    message: {
      Caller: caller,
      "Execute After": executeAfter.toString(),
      "Execute Before": executeBefore.toString(),
      "Allowed Methods": allowedMethods.map((method) => ({
        "Contract Address": method.contractAddress,
        Selector: method.selector,
      })),
      "Spending Limits": spendingLimits.map((limit) => ({
        token_address: limit.tokenAddress,
        amount: {
          low: limit.amount.low,
          high: limit.amount.high,
        },
      })),
    },
  };
}

async function setupHTLCSession() {
  console.log("🎯 HTLC Session Setup Script\n");

  try {
    // Read deployed Braavos account
    const creds = readCreds();
    const account = getBravosAccount(creds);
    console.log(`📍 Braavos Account: ${creds.address}`);
    const SESSION_OWNER = process.env.SESSION_OWNER; // permission address

    if (!SESSION_OWNER) {
      console.error("❌ Error: SESSION_OWNER environment variable is required");
      console.error(
      "please set the permission address"
      );
      console.error("   Example: SESSION_OWNER=0x123... tsx cli/execute.ts");
      process.exit(1);
    }

    console.log(`   HTLC Contract: ${HTLC_ADDRESS}`);
    console.log(`   Token: ${TOKEN_ADDRESS}`);
    console.log(`   Session Owner (Caller): ${SESSION_OWNER}`);

    // Define time bounds for the session (24 hours from now by default)
    const now = Math.floor(Date.now() / 1000);
    const executeAfter = now - 3600; // Can execute from 1 hour ago (to avoid clock sync issues)
    const executeBefore = now + 24 * 60 * 60; // Valid for 24 hours
    console.log(
      `   Execute Before: ${new Date(executeBefore * 1000).toISOString()}`,
    );

    const allowedMethods = [
      {
        contractAddress: HTLC_ADDRESS,
        selector: hash.getSelectorFromName("initiate"),
      },
      {
        contractAddress: HTLC_ADDRESS,
        selector: hash.getSelectorFromName("redeem"),
      },
      {
        contractAddress: HTLC_ADDRESS,
        selector: hash.getSelectorFromName("refund"),
      },
    ];

    console.log(`\n📝 Allowed Methods:`);
    allowedMethods.forEach((method, i) => {
      const methodName = ["initiate", "redeem", "refund"][i];
      console.log(`   ${i + 1}. ${methodName} (selector: ${method.selector})`);
    });

    // Define spending limits (optional - set high limits or 0 if not needed)
    // For HTLC operations, we might want to limit token spending
    const MAX_UINT256_LOW = "0xffffffffffffffffffffffffffffffff";
    const MAX_UINT256_HIGH = "0xffffffffffffffffffffffffffffffff";

    const spendingLimits = [
      {
        tokenAddress: TOKEN_ADDRESS,
        amount: {
          low: MAX_UINT256_LOW,
          high: MAX_UINT256_HIGH,
        },
      },
    ];

    console.log(`\n💰 Spending Limits:`);
    console.log(`   Token: ${TOKEN_ADDRESS}`);
    console.log(`   Limit: unlimited (max u256)`);

    // Get chain ID
    const chainId = await provider.getChainId();
    console.log(`\n🔗 Chain ID: ${chainId}`);

    // Create typed data
    const typedData = createGasSponsoredSessionTypedData({
      accountAddress: creds.address, // TODO: needed for the v2 still need to read the contract a bit or ask pranav
      caller: SESSION_OWNER,
      executeAfter,
      executeBefore,
      allowedMethods,
      spendingLimits,
      chainId,
    });

    // Sign the session request with Braavos account (using Stark private key)
    console.log(`\n🔏 Signing session request with Stark signer...`);
    const signature = await account.signMessage(typedData);

    // Convert signature to array format
    // For session signatures, use simple [r, s] format (2 elements)
    // The signer type prefix is only used for transaction signatures, not typed data signatures
    const sigArray = Array.isArray(signature)
      ? signature
      : [signature.r.toString(), signature.s.toString()];

    console.log(`✅ Session signed successfully`);
    console.log(`   Signature: [${sigArray.length} elements (r + s)]`);

    // Calculate session hash
    const sessionHash = calculateSessionHash(typedData, creds.address);
    console.log(`\n🔑 Session Hash: ${sessionHash}`);

    // Save session information
    const sessionInfo: SessionInfo = {
      sessionHash,
      caller: SESSION_OWNER,
      executeAfter,
      executeBefore,
      allowedMethods: allowedMethods.map((m) => ({
        contractAddress: m.contractAddress,
        selector: m.selector,
      })),
      spendingLimits: spendingLimits.map((l) => ({
        tokenAddress: l.tokenAddress,
        amount: { low: l.amount.low, high: l.amount.high },
      })),
      signature: sigArray.map((s) => s.toString()),
      htlcAddress: HTLC_ADDRESS,
      braavosAccount: creds.address,
      createdAt: new Date().toISOString(),
    };

    const sessionFile = path.join(
      path.dirname(config.credsFile),
      "session.json",
    );
    writeJsonFile(sessionFile, sessionInfo);

    console.log(`\n📄 Session info saved to: ${sessionFile}`);
    console.log(`\n✅ Session setup complete!`);
    return sessionInfo;
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

setupHTLCSession();
