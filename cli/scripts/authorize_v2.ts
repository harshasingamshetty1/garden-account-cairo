#!/usr/bin/env node
import {
  readCreds,
  provider,
  getBravosAccount,
  calculateSessionHash,
} from "../utils";
import { writeJsonFile } from "../helpers/file";
import {
  createGasSponsoredSessionTypedDataV2,
  CalldataValidationType,
  CalldataValidation,
} from "../helpers/session_v2";
import { hash } from "starknet";
import path from "path";
import { config, HTLC_ADDRESS } from "../config/constants";
import { SessionInfo } from "../types";

interface SetupHTLCSessionV2Params {
  sessionOwner: string;
  executeAfterOffset?: number; // seconds before now (default: 3600)
  executeBeforeDuration?: number; // seconds from now (default: 24 hours)
  calldataValidations?: CalldataValidation[][]; // Optional calldata validations per method
}

export async function setupHTLCSessionV2(params: SetupHTLCSessionV2Params) {
  try {
    const {
      sessionOwner,
      executeAfterOffset = 3600,
      executeBeforeDuration = 24 * 60 * 60,
      calldataValidations,
    } = params;

    if (!sessionOwner) {
      throw new Error("sessionOwner parameter is required");
    }

    const creds = readCreds();
    const account = getBravosAccount(creds);

    const now = Math.floor(Date.now() / 1000);
    const executeAfter = now - executeAfterOffset;
    const executeBefore = now + executeBeforeDuration;

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

    const finalCalldataValidations = calldataValidations || [[], [], []];

    if (calldataValidations && calldataValidations.length > 0) {
      console.log("🔍 Calldata Validations:");
      calldataValidations.forEach((validations, methodIndex) => {
        if (validations.length > 0) {
          console.log(`   Method ${methodIndex}:`);
          validations.forEach((v) => {
            console.log(
              `     - Offset ${v.offset}: ${v.value} (${v.validation_type === CalldataValidationType.Eq ? "Eq" : "Unknown"})`,
            );
          });
        }
      });
      console.log("");
    }

    const spendingLimits = [
      {
        tokenAddress: config.htlcTokenAddress,
        amount: {
          low: "0xffffffffffffffffffffffffffffffff",
          high: "0xffffffffffffffffffffffffffffffff",
        },
      },
    ];

    console.log("💰 Spending Limits:");
    console.log(`   Token: ${config.htlcTokenAddress}`);

    const chainId = await provider.getChainId();
    const typedData = createGasSponsoredSessionTypedDataV2({
      accountAddress: creds.address,
      caller: sessionOwner,
      executeAfter,
      executeBefore,
      allowedMethods,
      spendingLimits,
      calldataValidations: finalCalldataValidations,
      chainId,
    });

    console.log("🔐 Signing session authorization...");
    const signature = await account.signMessage(typedData);
    const sigArray = Array.isArray(signature)
      ? signature
      : [signature.r.toString(), signature.s.toString()];

    const sessionHash = calculateSessionHash(typedData, creds.address);
    console.log(`\n🔑 Session Hash: ${sessionHash}`);

    // Save session information
    const sessionInfo: SessionInfo = {
      sessionHash,
      caller: sessionOwner,
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

    console.log("\n✅ HTLC session V2 authorized successfully!");
    console.log(`   Session file: ${sessionFile}`);
    console.log(
      `\n📝 Note: This is a V2 session with calldata validation support\n`,
    );

    return sessionInfo;
  } catch (error) {
    console.error(
      "\n❌ HTLC session V2 failed:",
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

// if (require.main === module) {
//   const SESSION_OWNER = process.env.SESSION_OWNER || process.argv[2];

//   if (!SESSION_OWNER) {
//     console.error("❌ SESSION_OWNER parameter required");
//     process.exit(1);
//   }

//   setupHTLCSessionV2({
//     sessionOwner: SESSION_OWNER,
//     // calldataValidations: validations, // Uncomment to use validations
//   });
// }
