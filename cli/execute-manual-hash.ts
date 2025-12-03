#!/usr/bin/env node
import "dotenv/config";
import { Account, hash, RpcProvider, ec, Signature, num } from "starknet";
import path from "path";
import { readJsonFile, writeJsonFile } from "./helpers/file";
import { config } from "./config";

interface DeploymentCredentials {
  address: string;
  privateKey: string;
  publicKey: string;
}

interface SignerInfo {
  starkPubKey: string;
  secp256r1PubKey: string;
  secp256r1Signature: {
    r: string;
    s: string;
  };
}

async function setupSession() {
  try {
    console.log("🎯 HTLC Session Setup (Manual Hash) Script\n");

    // Load deployment credentials
    const creds = readJsonFile<DeploymentCredentials>(config.credsFile);
    console.log(`📍 Braavos Account: ${creds.address}\n`);

    // Setup provider
    const provider = new RpcProvider({
      nodeUrl: config.nodeUrl,
    });

    // Configuration (use from previous session for consistency)
    const HTLC_ADDRESS =
      "0x06579d255314109429a4477d89629bc2b94f529ae01979c2f8014f9246482603";
    const TOKEN_ADDRESS =
      "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5";
    const SESSION_OWNER =
      "0x07a55af245d4a6105770e701868e364375fe48ff2b2d8ac6a3c712cc01beca26";

    console.log(`📋 Configuration:`);
    console.log(`   HTLC Contract: ${HTLC_ADDRESS}`);
    console.log(`   Token: ${TOKEN_ADDRESS}`);
    console.log(`   Session Owner (Caller): ${SESSION_OWNER}`);

    // Define time bounds for session
    const now = Math.floor(Date.now() / 1000);
    const HOUR = 3600;
    const DAY = 24 * HOUR;

    const executeAfter = now;
    const executeBefore = now + DAY + HOUR;

    console.log(`\n⏰ Session Time Bounds:`);
    console.log(
      `   Execute After: ${new Date(executeAfter * 1000).toISOString()}`,
    );
    console.log(
      `   Execute Before: ${new Date(executeBefore * 1000).toISOString()}`,
    );

    // Define allowed methods on HTLC contract
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

    // Compute GUIDs
    console.log(`\n🔑 Computing GUIDs...`);
    const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
      '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
    );

    const guids = allowedMethods.map((method, i) => {
      const guid = hash.computePoseidonHashOnElements([
        ALLOWED_METHOD_TYPE_HASH,
        method.contractAddress,
        method.selector,
      ]);
      console.log(`   ${i + 1}. ${guid}`);
      return guid;
    });

    const guidsHash = hash.computePoseidonHashOnElements(guids);
    console.log(`   GUIDs Hash: ${guidsHash}`);

    // Define spending limits
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

    // Compute spending limits hash
    const U256_TYPE_HASH = hash.getSelectorFromName(
      '"u256"("low":"u128","high":"u128")',
    );
    const TOKEN_AMOUNT_TYPE_HASH = hash.getSelectorFromName(
      '"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
    );

    const spendingLimitHashes = spendingLimits.map((limit) => {
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
    console.log(`   Spending Limits Hash: ${spendingLimitsHash}`);

    // Compute message hash
    console.log(`\n📊 Computing Message Hash...`);
    const GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH = hash.getSelectorFromName(
      '"GasSponsoredSessionExecution"("Caller":"ContractAddress","Execute After":"timestamp","Execute Before":"timestamp","Allowed Methods":"AllowedMethod*","Spending Limits":"TokenAmount*")"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")"TokenAmount"("token_address":"ContractAddress","amount":"u256")"u256"("low":"u128","high":"u128")',
    );

    const messageHash = hash.computePoseidonHashOnElements([
      GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH,
      SESSION_OWNER,
      executeAfter.toString(),
      executeBefore.toString(),
      guidsHash,
      spendingLimitsHash,
    ]);

    console.log(`   Type Hash: ${GAS_SPONSORED_SESSION_EXECUTION_TYPE_HASH}`);
    console.log(`   Message Hash: ${messageHash}`);

    // Compute domain hash
    console.log(`\n🌐 Computing Domain Hash...`);
    const chainId = await provider.getChainId();
    console.log(`   Chain ID: ${chainId}`);

    const STARKNET_DOMAIN_TYPE_HASH = hash.getSelectorFromName(
      '"StarknetDomain"("name":"shortstring","version":"shortstring","chainId":"shortstring","revision":"shortstring")',
    );

    const domainHash = hash.computePoseidonHashOnElements([
      STARKNET_DOMAIN_TYPE_HASH,
      hash.getSelectorFromName("Account.execute_gs_session"),
      "2", // version
      chainId,
      "1", // revision
    ]);

    console.log(`   Domain Hash: ${domainHash}`);

    // Compute final SNIP-12 hash
    console.log(`\n🔒 Computing Final SNIP-12 Hash...`);
    const sessionHash = hash.computePoseidonHashOnElements([
      hash.getSelectorFromName("StarkNet Message"),
      domainHash,
      creds.address,
      messageHash,
    ]);

    console.log(`   Session Hash: ${sessionHash}`);

    // Sign the hash directly
    console.log(`\n🔏 Signing session hash...`);

    // Create account to sign
    const account = new Account({
      provider,
      address: creds.address,
      signer: creds.privateKey,
    });

    // Sign the hash directly (not using TypedData)
    const msgHashBigInt = num.toBigInt(sessionHash);
    const signatureArray = await account.signer.signRaw(msgHashBigInt);

    console.log(`✅ Session signed successfully`);
    console.log(
      `   Signature: [${signatureArray[0].toString()}, ${signatureArray[1].toString()}]`,
    );

    // Save session info
    const sessionInfo = {
      sessionHash,
      caller: SESSION_OWNER,
      executeAfter,
      executeBefore,
      allowedMethods,
      spendingLimits,
      signature: [signatureArray[0].toString(), signatureArray[1].toString()],
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
    console.log(`\n📋 Next Steps:`);
    console.log(
      `   1. The address ${SESSION_OWNER} can now execute HTLC operations`,
    );
    console.log(
      `   2. They need to call execute_gas_sponsored_session_tx on the Braavos account`,
    );
    console.log(
      `   3. The session is valid until ${new Date(executeBefore * 1000).toISOString()}`,
    );
    console.log(
      `\n💡 Note: The caller needs to have the session info and signature to execute transactions`,
    );
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

setupSession();
