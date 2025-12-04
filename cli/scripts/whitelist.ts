#!/usr/bin/env node
import {
  readCreds,
  provider,
  getBravosAccount,
  calculateSessionHash,
} from "../utils";
import { writeJsonFile } from "../helpers/file";
import {
  createGasSponsoredSessionTypedData,
  MAX_UINT256,
} from "../helpers/session";
import { hash } from "starknet";
import path from "path";
import { config } from "../config/constants";

interface SetupWhitelistSessionParams {
  whitelistAddress: string;
  executeAfterOffset?: number; // seconds before now (default: 3600)
  executeBeforeDuration?: number; // seconds from now (default: 1 year)
}

export async function setupWhitelistSession(
  params: SetupWhitelistSessionParams,
) {
  try {
    const {
      whitelistAddress,
      executeAfterOffset = 3600,
      executeBeforeDuration = 365 * 24 * 60 * 60, // 1 year default
    } = params;

    if (
      !whitelistAddress ||
      whitelistAddress ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      throw new Error("Valid whitelistAddress is required");
    }

    if (config.whitelistTokenAddresses.length === 0) {
      throw new Error("No tokens configured in whitelistTokenAddresses");
    }

    const creds = readCreds();
    const account = getBravosAccount(creds);

    const now = Math.floor(Date.now() / 1000);
    const executeAfter = now - executeAfterOffset;
    const executeBefore = now + executeBeforeDuration;

    const allowedMethods = config.whitelistTokenAddresses.map(
      (tokenAddress) => ({
        contractAddress: tokenAddress,
        selector: hash.getSelectorFromName("transfer"),
      }),
    );

    const spendingLimits = config.whitelistTokenAddresses.map(
      (tokenAddress) => ({
        tokenAddress,
        amount: {
          low: MAX_UINT256.LOW,
          high: MAX_UINT256.HIGH,
        },
      }),
    );

    const chainId = await provider.getChainId();
    const typedData = createGasSponsoredSessionTypedData({
      accountAddress: creds.address,
      caller: whitelistAddress,
      executeAfter,
      executeBefore,
      allowedMethods,
      spendingLimits,
      chainId,
    });

    const signature = await account.signMessage(typedData);
    const sigArray = Array.isArray(signature)
      ? signature
      : [signature.r.toString(), signature.s.toString()];

    const sessionHash = calculateSessionHash(typedData, creds.address);
    console.log(`\n🔑 Session Hash: ${sessionHash}`);

    // Save session information
    const whitelistSessionInfo = {
      sessionHash,
      caller: whitelistAddress,
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
      whitelistTokens: config.whitelistTokenAddresses,
      braavosAccount: creds.address,
      createdAt: new Date().toISOString(),
    };

    const whitelistSessionFile = path.join(
      path.dirname(config.credsFile),
      "whitelist_session.json",
    );
    writeJsonFile(whitelistSessionFile, whitelistSessionInfo);

    console.log(`✅ Whitelist session authorized`);
    return whitelistSessionInfo;
  } catch (error) {
    console.error(
      "❌ Whitelist session failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

// if (require.main === module) {
//   const whitelistAddress = config.whitelistAddress;

//   if (!whitelistAddress || whitelistAddress === "0x0000000000000000000000000000000000000000000000000000000000000000") {
//     console.error("❌ whitelistAddress not configured in config.json");
//     process.exit(1);
//   }

//   setupWhitelistSession({ whitelistAddress });
// }
