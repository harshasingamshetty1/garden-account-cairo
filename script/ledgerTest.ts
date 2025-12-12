import * as TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { LedgerSigner231, constants, Account, Provider, CallData, hash, typedData } from "starknet";
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), "script", ".env") });

async function main() {
  const accountAddress = process.env.ACCOUNT_ADDRESS;
  const rpcUrl = process.env.STARKNET_NODE_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/GE3ckFWo2EhIEsrrYkc55";
  
  if (!accountAddress) {
    console.error("❌ Set ACCOUNT_ADDRESS in env");
    process.exit(1);
  }

  const chainId = process.env.CHAIN_ID || constants.StarknetChainId.SN_SEPOLIA;

  console.log("🔌 Connecting to Ledger...");
  
  // Connect to Ledger device via HID transport
  const transport = await TransportNodeHid.default.create();
  if (!transport) {
    throw new Error("Failed to connect to Ledger device");
  }

  const ledgerSigner = new LedgerSigner231(transport, 0); // derivation path index 0

  console.log("🔑 Fetching Ledger Starknet public key...");
  const pubkey = await ledgerSigner.getPubKey();
  console.log("✅ Public Key:", pubkey);


  transport.close();
  console.log("✅ Ledger connection closed");
  // // Initialize provider and account
  // const provider = new Provider({ nodeUrl: rpcUrl });
  // const ledgerAccount = new Account({provider:provider, address: accountAddress, signer: ledgerSigner});

  // console.log("\n📊 Account Information:");
  // console.log(`   Address: ${accountAddress}`);
  // console.log(`   Public Key: ${pubkey}`);
  // console.log(`   Chain ID: ${chainId}`);

  // // Example 3: Sign a transaction (alternative to execute)
  // try {
  //   console.log("\n\n=== Signing Transaction with Ledger ===\n");
    
  //   const transferCall = {
  //     contractAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  //     entrypoint: "transfer",
  //     calldata: CallData.compile({
  //       recipient: "0x048248450B72751Ab65c354940e89b0b8BabF281B212E31eD8F318DF43F57954",
  //       amount: { low: "1000000000000000000", high: "0" },
  //     }),
  //   };

  //   console.log("📝 Transaction Details:");
  //   console.log(`   To: ${transferCall.contractAddress}`);
  //   console.log(`   Method: ${transferCall.entrypoint}`);

  //   // Get nonce
  //   const nonce = await ledgerAccount.getNonce();
  //   console.log(`   Nonce: ${nonce}`);

  //   // Estimate fee
  //   console.log("\n⛽ Estimating fee...");
  //   const feeEstimate = await ledgerAccount.estimateInvokeFee([transferCall]);
  //   console.log(`   Estimated Gas: ${feeEstimate.gas_consumed}`);
  //   console.log(`   Overall Fee: ${feeEstimate.overall_fee}`);

  //   // Execute transaction with Ledger signing
  //   console.log("\n🔐 Signing transaction with Ledger (approve on device)...");
  //   const txResult = await ledgerAccount.execute([transferCall]);
    
  //   console.log("\n✅ Transaction signed and submitted!");
  //   console.log(`   Transaction Hash: ${txResult.transaction_hash}`);

  //   // Wait for confirmation
  //   console.log("\n⏳ Waiting for transaction confirmation...");
  //   const receipt = await provider.waitForTransaction(txResult.transaction_hash, {
  //     retryInterval: 5000,
  //   });

  //   const success = typeof receipt.isSuccess === "function" 
  //     ? receipt.isSuccess() 
  //     : receipt.isSuccess;

  //   if (success) {
  //     console.log("✅ Transaction confirmed successfully!");
  //   } else {
  //     console.log("❌ Transaction failed");
  //   }

  // } catch (txErr: any) {
  //   console.error("❌ Ledger transaction signing failed:", txErr.message);
  //   if (txErr.message.includes("0x5500")) {
  //     console.error("   → Device rejected the transaction");
  //   } else if (txErr.message.includes("0x5501")) {
  //     console.error("   → User denied signing");
  //   }
  // }

  // await transport.close();
  // console.log("\n\n✅ Ledger connection closed");
}

main().catch(async (err) => {
  console.error("❌ Ledger test failed:", err);
  process.exit(1);
});

