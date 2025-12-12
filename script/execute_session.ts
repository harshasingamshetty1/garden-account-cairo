#!/usr/bin/env node
/**
 * execute_session.ts
 * 
 * Executes a gas-sponsored session transfer using previously saved session data.
 * The session must be created first using create_session.ts
 */
import { Account, Call, RpcProvider, hash } from "starknet";
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), "script", ".env") });

interface SessionData {
  sessionHash: string;
  braavosAccountAddress: string;
  sessionCaller: string;
  tokenAddress: string;
  targetAddress: string;
  chainId: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethodGuids: string[];
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  calldataValidations: Array<
    Array<{ offset: number; value: string; validation_type: number }>
  >;
  signature: {
    r: string;
    s: string;
  };
  ledgerPublicKey: string;
  createdAt: string;
}

function splitU256(value: bigint | string): [string, string] {
  const val = BigInt(value);
  const mask = (1n << 128n) - 1n;
  const low = val & mask;
  const high = val >> 128n;
  return [low.toString(), high.toString()];
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
}): string[] {
  const {
    executeAfter,
    executeBefore,
    allowedMethodGuids,
    spendingLimits,
    calldataValidations,
    calls,
    callHints,
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

  calldata.push(calldataValidations.length.toString());
  for (const validations of calldataValidations) {
    calldata.push(validations.length.toString());
    for (const v of validations) {
      calldata.push(v.offset.toString());
      calldata.push(v.value);
      calldata.push(v.validation_type.toString());
    }
  }

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

  calldata.push(callHints.length.toString());
  calldata.push(...callHints.map((h) => h.toString()));

  return calldata;
}

async function main() {
  const nodeUrl = process.env.STARKNET_NODE_URL;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const transferAmountEnv = process.env.TRANSFER_AMOUNT || "1";

  if (!deployerPrivateKey) {
    console.error("Missing DEPLOYER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  // Load session data
  const sessionDataPath = path.join(process.cwd(), "script", "session_data.json");
  
  if (!fs.existsSync(sessionDataPath)) {
    console.error(`Session data not found at ${sessionDataPath}`);
    console.error("Run 'tsx script/create_session.ts' first to create a session.");
    process.exit(1);
  }

  const sessionData: SessionData = JSON.parse(fs.readFileSync(sessionDataPath, 'utf8'));

  console.log("\n📋 Loaded Session Data:");
  console.log(`   Session Hash: ${sessionData.sessionHash}`);
  console.log(`   Braavos Account: ${sessionData.braavosAccountAddress}`);
  console.log(`   Session Caller: ${sessionData.sessionCaller}`);
  console.log(`   Token: ${sessionData.tokenAddress}`);
  console.log(`   Target: ${sessionData.targetAddress}`);
  console.log(`   Created At: ${sessionData.createdAt}`);

  // Check session validity
  const now = Math.floor(Date.now() / 1000);
  if (now < sessionData.executeAfter) {
    console.error(`\n❌ Session not yet valid. Starts at: ${new Date(sessionData.executeAfter * 1000).toISOString()}`);
    process.exit(1);
  }
  if (now > sessionData.executeBefore) {
    console.error(`\n❌ Session expired at: ${new Date(sessionData.executeBefore * 1000).toISOString()}`);
    process.exit(1);
  }
  console.log(`   ✅ Session is valid (expires: ${new Date(sessionData.executeBefore * 1000).toISOString()})`);

  const provider = nodeUrl ? new RpcProvider({ nodeUrl }) : new RpcProvider();
  
  const deployer = new Account({
    provider,
    address: sessionData.sessionCaller,
    signer: deployerPrivateKey,
  });

  // Check balances before transfer
  console.log("\n💰 Checking balances...");
  
  try {
    const tokenContract = sessionData.tokenAddress;
    const braavosAccount = sessionData.braavosAccountAddress;
    
    // Call balanceOf on the token contract
    const balanceResult = await provider.callContract({
      contractAddress: tokenContract,
      entrypoint: "balanceOf",
      calldata: [braavosAccount],
    });
    
    const balanceLow = BigInt(balanceResult[0]);
    const balanceHigh = BigInt(balanceResult[1] || "0");
    const balance = balanceLow + (balanceHigh << 128n);
    
    console.log(`   Braavos Account Balance: ${balance.toString()} (raw)`);
    console.log(`   Braavos Account Balance: ${Number(balance) / 1e18} tokens`);
    
    const transferAmount = BigInt(transferAmountEnv);
    console.log(`   Transfer Amount: ${transferAmount.toString()} (raw)`);
    
    if (balance < transferAmount) {
      console.error(`\n❌ Insufficient balance!`);
      console.error(`   Has: ${balance.toString()}`);
      console.error(`   Needs: ${transferAmount.toString()}`);
      process.exit(1);
    }
    console.log(`   ✅ Sufficient balance for transfer`);
  } catch (err) {
    console.warn(`   ⚠️  Could not check balance: ${err}`);
  }

  // Build transfer call
  const transferAmount = BigInt(transferAmountEnv);
  const [amountLow, amountHigh] = splitU256(transferAmount);

  console.log(`\n📤 Preparing Transfer:`);
  console.log(`   From: ${sessionData.braavosAccountAddress}`);
  console.log(`   To: ${sessionData.targetAddress}`);
  console.log(`   Amount: ${transferAmount.toString()} (low: ${amountLow}, high: ${amountHigh})`);

  const calls: Call[] = [
    {
      contractAddress: sessionData.tokenAddress,
      entrypoint: "transfer",
      calldata: [sessionData.targetAddress, amountLow, amountHigh],
    },
  ];

  const requestCalldata = buildCalldataV2({
    executeAfter: sessionData.executeAfter,
    executeBefore: sessionData.executeBefore,
    allowedMethodGuids: sessionData.allowedMethodGuids,
    spendingLimits: sessionData.spendingLimits,
    calldataValidations: sessionData.calldataValidations,
    calls,
    callHints: [0],
  });

  const signatureCalldata = [
    "2", // signature length
    sessionData.signature.r,
    sessionData.signature.s,
  ];

  const fullCalldata = [...requestCalldata, ...signatureCalldata];

  console.log("\n📊 Full Calldata (length=" + fullCalldata.length + "):");
  fullCalldata.forEach((item, i) => {
    console.log(`  [${i}]: ${item}`);
  });

  console.log("\n➡️  Submitting transaction from deployer...");

  try {
    const { transaction_hash } = await deployer.execute({
      contractAddress: sessionData.braavosAccountAddress,
      entrypoint: "execute_gas_sponsored_session_tx_v2",
      calldata: fullCalldata,
    });

    console.log("\n✅ Transaction Submitted!");
    console.log(`   Tx Hash: ${transaction_hash}`);
    console.log(`\n🔗 View on Starkscan: https://sepolia.starkscan.co/tx/${transaction_hash}`);

    console.log("\n⏳ Waiting for confirmation...");
    const receipt = await provider.waitForTransaction(transaction_hash, {
      retryInterval: 5000,
    });

    const success = typeof receipt.isSuccess === "function" 
      ? receipt.isSuccess() 
      : receipt.isSuccess;

    if (success) {
      console.log("\n✅ Transaction SUCCEEDED!");
    } else {
      console.log("\n❌ Transaction FAILED!");
      console.log("Receipt:", JSON.stringify(receipt, null, 2));
    }
  } catch (err: any) {
    console.error("\n❌ Transaction failed:", err?.message || err);
    
    // Parse error details
    if (err?.baseError?.data?.execution_error) {
      const execError = err.baseError.data.execution_error;
      console.log("\n🔍 Error Details:");
      console.log(`   Contract: ${execError.contract_address}`);
      console.log(`   Error: ${execError.error}`);
    }
    
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("❌ Failed to execute session:", err);
  process.exit(1);
});
