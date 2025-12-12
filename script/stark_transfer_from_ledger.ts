#!/usr/bin/env node
import { Account, Call, RpcProvider, hash, LedgerSigner231 } from "starknet";
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import * as dotenv from 'dotenv';
import path from "node:path";

// Load .env from script directory
dotenv.config({ path: path.join(process.cwd(), "script", ".env") });

async function main() {
  // Load environment variables
  const nodeUrl = process.env.STARKNET_NODE_URL;
  const braavosAccount = process.env.ACCOUNT_ADDRESS;
  const targetContract = process.env.TARGET_CONTRACT;
  const targetAddress = process.env.TARGET_ADDRESS;
  const targetSelector = process.env.TARGET_SELECTOR || "transfer";

  // Validate required environment variables
  const required = {
    ACCOUNT_ADDRESS: braavosAccount,
    TARGET_CONTRACT: targetContract,
    TARGET_ADDRESS: targetAddress,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  
  if (missing.length) {
    console.error(
      `Missing required env vars: ${missing.join(", ")}. Please set them in script/.env`,
    );
    process.exit(1);
  }

  const acctAddr = braavosAccount!;
  const contractAddr = targetContract!;
  const recipientAddr = targetAddress!;

  // 1 STARK = 1e18 (18 decimals)
  const transferAmount = BigInt("1000000000000000000"); // 1 STARK
  const amountUint256 = {
    low: transferAmount,
    high: 0n,
  };

  // Initialize provider
  const provider = nodeUrl
    ? new RpcProvider({ nodeUrl })
    : new RpcProvider();

  console.log("\n📋 Transfer Parameters:");
  console.log(`   From (Braavos Account): ${acctAddr}`);
  console.log(`   To (Recipient): ${recipientAddr}`);
  console.log(`   Token Contract: ${contractAddr}`);
  console.log(`   Amount: 1 STARK (${transferAmount.toString()})`);

  // Check balance first
  console.log("\n💰 Checking balance...");
  try {
    const balanceResult = await provider.callContract({
      contractAddress: contractAddr,
      entrypoint: "balanceOf",
      calldata: [acctAddr],
    });
    const balance = BigInt(balanceResult[0]) + (BigInt(balanceResult[1] || "0") << 128n);
    console.log(`   Balance: ${Number(balance) / 1e18} STRK`);
    
    if (balance < transferAmount) {
      throw new Error(`Insufficient balance: has ${Number(balance) / 1e18} STRK, needs 1 STRK`);
    }
  } catch (err: any) {
    if (err.message?.includes("Insufficient")) throw err;
    console.warn(`   ⚠️  Could not check balance: ${err.message}`);
  }

  // Connect to Ledger device
  console.log("\n🔌 Connecting to Ledger device...");
  console.log("   Please make sure:");
  console.log("   1. Ledger is connected via USB");
  console.log("   2. Starknet app is open on Ledger");
  console.log("   3. No other app is using the Ledger\n");
  
  const transport = await TransportNodeHid.create();
  if (!transport) {
    throw new Error("Failed to connect to Ledger device");
  }
  console.log("✅ Ledger connected");

  // Create Ledger signer
  const ledgerSigner = new LedgerSigner231(transport, 0);

  // Get and verify public key
  console.log("\n🔑 Fetching Ledger public key...");
  const ledgerPubKey = await ledgerSigner.getPubKey();
  console.log(`   Ledger Public Key: ${ledgerPubKey}`);

  // Verify against account owner
  try {
    const signersResult = await provider.callContract({
      contractAddress: acctAddr,
      entrypoint: "get_signers",
      calldata: [],
    });
    
    const resultArray = Array.isArray(signersResult) ? signersResult : [];
    if (resultArray.length >= 2) {
      const starkSignersLen = Number(resultArray[0]);
      if (starkSignersLen > 0) {
        const accountOwnerPubKey = resultArray[1];
        console.log(`   Account Owner Key: ${accountOwnerPubKey}`);
        
        // Normalize both keys for comparison (remove leading zeros after 0x)
        const normalizeKey = (key: string) => {
          const hex = key.replace(/^0x0*/, '');
          return '0x' + hex;
        };
        
        const normalizedOwner = normalizeKey(accountOwnerPubKey);
        const normalizedLedger = normalizeKey(ledgerPubKey);
        
        if (normalizedOwner !== normalizedLedger) {
          await transport.close();
          throw new Error(
            `Public key mismatch!\n` +
            `   Account owner: ${accountOwnerPubKey}\n` +
            `   Ledger key: ${ledgerPubKey}\n` +
            `   The Ledger does not own this account.`
          );
        }
        console.log(`   ✅ Keys match!`);
      }
    }
  } catch (err: any) {
    if (err.message?.includes("mismatch")) throw err;
    console.warn(`   ⚠️  Could not verify: ${err.message}`);
  }

  // Create account with Ledger signer
  // IMPORTANT: Do not close transport until after execute() completes
  const account = new Account({
    provider,
    address: acctAddr,
    signer: ledgerSigner,
  });

  // Build the transfer call
  const calls: Call[] = [
    {
      contractAddress: contractAddr,
      entrypoint: targetSelector,
      calldata: [
        recipientAddr,
        amountUint256.low.toString(),
        amountUint256.high.toString(),
      ],
    },
  ];

  console.log("\n📝 Transaction:");
  console.log(`   Transfer 1 STRK from ${acctAddr}`);
  console.log(`   To: ${recipientAddr}`);

  // Execute transaction
  console.log("\n✍️  Please approve the transaction on your Ledger device...");
  console.log("   ⚠️  DO NOT disconnect the Ledger until the transaction is submitted!\n");

  const { transaction_hash } = await account.execute(calls);

  console.log("✅ Transaction submitted!");
  console.log(`   Tx Hash: ${transaction_hash}`);
  console.log(`\n🔗 https://sepolia.starkscan.co/tx/${transaction_hash}`);

  // NOW close the transport after execute completes
  await transport.close();
  console.log("✅ Ledger disconnected");

  // Wait for confirmation
  console.log("\n⏳ Waiting for confirmation...");
  const receipt = await provider.waitForTransaction(transaction_hash, {
    retryInterval: 5000,
  });

  const success = typeof receipt.isSuccess === "function" 
    ? receipt.isSuccess() 
    : receipt.isSuccess;

  if (success) {
    console.log("\n✅ Transaction SUCCEEDED!");
    console.log(`   Transferred 1 STRK to ${recipientAddr}`);
  } else {
    console.log("\n❌ Transaction REVERTED!");
    console.log("Receipt:", JSON.stringify(receipt, null, 2));
  }
}

main().catch(async (err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exit(1);
});
