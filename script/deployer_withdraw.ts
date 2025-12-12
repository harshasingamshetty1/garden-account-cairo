#!/usr/bin/env node
/**
 * deployer_withdraw.ts
 * 
 * The deployer withdraws 1 STRK from the Braavos account using an authorized session.
 * The session was previously created and signed by the Ledger owner.
 * 
 * Flow:
 * 1. Load session data from session_data.json
 * 2. Build transfer call (Braavos -> Deployer)
 * 3. Execute via gas-sponsored session (deployer pays gas)
 * 
 * Usage:
 *   tsx script/deployer_withdraw.ts
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

  // GasSponsoredSessionExecutionRequestV2 struct
  calldata.push(executeAfter.toString());
  calldata.push(executeBefore.toString());

  // allowed_method_guids
  calldata.push(allowedMethodGuids.length.toString());
  calldata.push(...allowedMethodGuids);

  // spending_limits
  calldata.push(spendingLimits.length.toString());
  for (const limit of spendingLimits) {
    calldata.push(limit.tokenAddress);
    calldata.push(limit.amount.low);
    calldata.push(limit.amount.high);
  }

  // allowed_method_calldata_validations
  calldata.push(calldataValidations.length.toString());
  for (const validations of calldataValidations) {
    calldata.push(validations.length.toString());
    for (const v of validations) {
      calldata.push(v.offset.toString());
      calldata.push(v.value);
      calldata.push(v.validation_type.toString());
    }
  }

  // calls
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

  // call_hints
  calldata.push(callHints.length.toString());
  calldata.push(...callHints.map((h) => h.toString()));

  return calldata;
}

async function main() {
  console.log("===========================================");
  console.log("  DEPLOYER WITHDRAW: 1 STRK via Session");
  console.log("===========================================\n");

  const nodeUrl = process.env.STARKNET_NODE_URL;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const deployerAddress = process.env.DEPLOYER_ADDRESS;

  if (!deployerPrivateKey || !deployerAddress) {
    console.error("Missing DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS in .env");
    process.exit(1);
  }

  // Load session data
  const sessionDataPath = path.join(process.cwd(), "script", "session_data.json");
  
  if (!fs.existsSync(sessionDataPath)) {
    console.error(`❌ Session data not found at ${sessionDataPath}`);
    console.error("\n💡 First create a session by running:");
    console.error("   tsx script/create_session.ts");
    process.exit(1);
  }

  const sessionData: SessionData = JSON.parse(fs.readFileSync(sessionDataPath, 'utf8'));

  console.log("📋 Session Info:");
  console.log(`   Braavos Account: ${sessionData.braavosAccountAddress}`);
  console.log(`   Session Caller (Deployer): ${sessionData.sessionCaller}`);
  console.log(`   Token: ${sessionData.tokenAddress}`);
  console.log(`   Authorized Recipient: ${sessionData.targetAddress}`);
  console.log(`   Session Created: ${sessionData.createdAt}`);

  // Verify deployer matches session caller
  const normalizeAddr = (addr: string) => addr.toLowerCase().replace(/^0x0*/, '0x');
  if (normalizeAddr(deployerAddress) !== normalizeAddr(sessionData.sessionCaller)) {
    console.error(`\n❌ Deployer address mismatch!`);
    console.error(`   .env DEPLOYER_ADDRESS: ${deployerAddress}`);
    console.error(`   Session caller: ${sessionData.sessionCaller}`);
    process.exit(1);
  }

  // Check session validity
  const now = Math.floor(Date.now() / 1000);
  if (now < sessionData.executeAfter) {
    console.error(`\n❌ Session not yet valid!`);
    console.error(`   Starts at: ${new Date(sessionData.executeAfter * 1000).toISOString()}`);
    process.exit(1);
  }
  if (now > sessionData.executeBefore) {
    console.error(`\n❌ Session expired!`);
    console.error(`   Expired at: ${new Date(sessionData.executeBefore * 1000).toISOString()}`);
    process.exit(1);
  }
  
  const expiresIn = sessionData.executeBefore - now;
  const hours = Math.floor(expiresIn / 3600);
  const minutes = Math.floor((expiresIn % 3600) / 60);
  console.log(`   ✅ Session valid (expires in ${hours}h ${minutes}m)`);

  const provider = nodeUrl ? new RpcProvider({ nodeUrl }) : new RpcProvider();

  // Check Braavos account balance
  console.log("\n💰 Checking balances...");
  try {
    const balanceResult = await provider.callContract({
      contractAddress: sessionData.tokenAddress,
      entrypoint: "balanceOf",
      calldata: [sessionData.braavosAccountAddress],
    });
    const balance = BigInt(balanceResult[0]) + (BigInt(balanceResult[1] || "0") << 128n);
    console.log(`   Braavos Account: ${Number(balance) / 1e18} STRK`);
    
    if (balance < BigInt("1000000000000000000")) {
      console.error(`\n❌ Insufficient balance in Braavos account!`);
      process.exit(1);
    }
  } catch (err) {
    console.warn(`   ⚠️  Could not check balance`);
  }

  // Create deployer account
  const deployer = new Account({
    provider,
    address: deployerAddress,
    signer: deployerPrivateKey,
  });

  // Transfer amount: 1 STRK
  const transferAmount = BigInt("1000000000000000000");
  const [amountLow, amountHigh] = splitU256(transferAmount);

  // The recipient MUST match the calldata validation (targetAddress)
  const recipient = sessionData.targetAddress;

  console.log(`\n📤 Preparing Withdrawal:`);
  console.log(`   From: ${sessionData.braavosAccountAddress} (Braavos)`);
  console.log(`   To: ${recipient} (Deployer)`);
  console.log(`   Amount: 1 STRK`);

  // Build transfer call
  const calls: Call[] = [
    {
      contractAddress: sessionData.tokenAddress,
      entrypoint: "transfer",
      calldata: [recipient, amountLow, amountHigh],
    },
  ];

  // Build session request calldata
  const requestCalldata = buildCalldataV2({
    executeAfter: sessionData.executeAfter,
    executeBefore: sessionData.executeBefore,
    allowedMethodGuids: sessionData.allowedMethodGuids,
    spendingLimits: sessionData.spendingLimits,
    calldataValidations: sessionData.calldataValidations,
    calls,
    callHints: [0],
  });

  // Append signature
  const signatureCalldata = [
    "2", // signature length
    sessionData.signature.r,
    sessionData.signature.s,
  ];

  const fullCalldata = [...requestCalldata, ...signatureCalldata];

  console.log("\n🔐 Using pre-authorized session signature");
  console.log(`   Session Hash: ${sessionData.sessionHash}`);

  console.log("\n➡️  Submitting withdrawal transaction...");
  console.log(`   Gas paid by: ${deployerAddress} (Deployer)`);

  try {
    const { transaction_hash } = await deployer.execute({
      contractAddress: sessionData.braavosAccountAddress,
      entrypoint: "execute_gas_sponsored_session_tx_v2",
      calldata: fullCalldata,
    });

    console.log("\n✅ Transaction Submitted!");
    console.log(`   Tx Hash: ${transaction_hash}`);
    console.log(`\n🔗 https://sepolia.starkscan.co/tx/${transaction_hash}`);

    console.log("\n⏳ Waiting for confirmation...");
    const receipt = await provider.waitForTransaction(transaction_hash, {
      retryInterval: 5000,
    });

    const success = typeof receipt.isSuccess === "function" 
      ? receipt.isSuccess() 
      : receipt.isSuccess;

    if (success) {
      console.log("\n✅ WITHDRAWAL SUCCEEDED!");
      console.log(`   1 STRK transferred from Braavos to Deployer`);
      
      // Check new balances
      try {
        const newBalance = await provider.callContract({
          contractAddress: sessionData.tokenAddress,
          entrypoint: "balanceOf",
          calldata: [sessionData.braavosAccountAddress],
        });
        const bal = BigInt(newBalance[0]) + (BigInt(newBalance[1] || "0") << 128n);
        console.log(`\n💰 New Braavos Balance: ${Number(bal) / 1e18} STRK`);
      } catch {}
    } else {
      console.log("\n❌ Transaction REVERTED!");
      console.log("Receipt:", JSON.stringify(receipt, null, 2));
    }
  } catch (err: any) {
    console.error("\n❌ Withdrawal failed:", err?.message || err);
    
    if (err?.baseError?.data?.execution_error) {
      const execError = err.baseError.data.execution_error;
      console.log("\n🔍 Error Details:");
      console.log(`   ${execError.error}`);
    }
    
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
