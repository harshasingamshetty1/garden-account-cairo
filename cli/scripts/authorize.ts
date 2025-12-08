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
  MIN_UINT256,
} from "../helpers/session";
import { hash } from "starknet";
import path from "path";
import { config, HTLC_ADDRESS } from "../config/constants";
import { SessionInfo } from "../types";

interface SetupHTLCSessionParams {
  sessionOwner: string;
  executeAfterOffset?: number; // seconds before now (default: 3600)
  executeBeforeDuration?: number; // seconds from now (default: 24 hours)
}

export async function setupHTLCSession(params: SetupHTLCSessionParams) {
  try {
    const {
      sessionOwner,
      executeAfterOffset = 3600,
      executeBeforeDuration = 24 * 60 * 60,
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

    const spendingLimits = [
      {
        tokenAddress: config.htlcTokenAddress,
        amount: {
          low: MIN_UINT256.LOW,
          high: MIN_UINT256.HIGH,
        },
      },
    ];

    const chainId = await provider.getChainId();
    const typedData = createGasSponsoredSessionTypedData({
      accountAddress: creds.address,
      caller: sessionOwner,
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
    console.log(`🔑 Session Hash: ${sessionHash}`);

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

    console.log(`✅ HTLC session authorized`);
    return sessionInfo;
  } catch (error) {
    console.error(
      "❌ HTLC session failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  const SESSION_OWNER = process.env.SESSION_OWNER;

  if (!SESSION_OWNER) {
    console.error("❌ SESSION_OWNER environment variable required");
    process.exit(1);
  }

  setupHTLCSession({ sessionOwner: SESSION_OWNER });
}
