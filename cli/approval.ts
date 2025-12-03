#!/usr/bin/env node
import { readCreds, provider, getBravosAccount } from "./utils";
import { Call } from "starknet";
import { HTLC_ADDRESS, TOKEN_ADDRESS } from "./config";

async function approveHTLCTokens() {
  console.log("🔐 HTLC Token Approval Script\n");

  try {
    const creds = readCreds();
    const account = getBravosAccount(creds);

    console.log(`📍 Braavos Account: ${creds.address}`);
    console.log(`\n📋 HTLC Address: ${HTLC_ADDRESS}`);
    console.log(`💰 Token Address: ${TOKEN_ADDRESS}`);

    const calls = buildApprovalCall(TOKEN_ADDRESS, HTLC_ADDRESS);
    const spender = calls.calldata?.[0] || "unknown";
    console.log(`📝 Spender: ${spender} `);

    const response = await account.execute(calls);

    await provider.waitForTransaction(response.transaction_hash, {
      retryInterval: 5000,
    });
    console.log(`✅ Transaction submitted: ${response.transaction_hash}`);
    await verifyAllowance(creds.address, HTLC_ADDRESS, TOKEN_ADDRESS);
    console.log(`\n✅ All approvals completed successfully!`);
  } catch (error) {
    console.error(
      `\n❌ Error:`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

function buildApprovalCall(tokens: string, htlcAddresses: string): Call {
  // Max uint256: low = 0xffffffffffffffffffffffffffffffff, high = 0xffffffffffffffffffffffffffffffff
  const MAX_UINT256_LOW = "0xffffffffffffffffffffffffffffffff";
  const MAX_UINT256_HIGH = "0xffffffffffffffffffffffffffffffff";

  // approve(spender: ContractAddress, amount: u256) in Starknet ERC20
  // Calldata: [spender (felt252), amount.low (u128), amount.high (u128)]
  const call: Call = {
    contractAddress: tokens,
    entrypoint: "approve",
    calldata: [htlcAddresses, MAX_UINT256_LOW, MAX_UINT256_HIGH],
  };

  return call;
}

/**
 * Verify that allowances were set correctly
 */
async function verifyAllowance(
  gardenSolverAddress: string,
  htlcAddress: string,
  token: string,
): Promise<void> {
  console.log(`\n📋 Verifying allowances...\n`);

  try {
    // Call allowance(owner, spender) on token contract
    const result = await provider.callContract({
      contractAddress: token,
      entrypoint: "allowance",
      calldata: [gardenSolverAddress, htlcAddress],
    });

    const allowanceResult = Array.isArray(result) ? result : [result];
    const allowance = allowanceResult[0]?.toString() || "0";
    console.log(`   HTLC ${htlcAddress} allowance: ${allowance}`);

    if (allowance === "0") {
      console.warn("approval failed maybe");
    }
  } catch (error) {
    console.error(
      `   ❌ Error verifying allowance for HTLC ${htlcAddress}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Run the script
approveHTLCTokens();
