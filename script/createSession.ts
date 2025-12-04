#!/usr/bin/env node
import { Account, Call, CallData, RpcProvider } from "starknet";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

dotenv.config();

type NetworkType = "sepolia" | "mainnet" | "devnet";

type ExampleCreds = {
  privateKey: string;
  publicKeyX: string;
  publicKeyY: string;
  address: string;
};

const EXAMPLE_PATH = path.join(__dirname, "example.json");

function readExampleCreds(): ExampleCreds {
  if (!fs.existsSync(EXAMPLE_PATH)) {
    throw new Error(
      `Missing example.json at ${EXAMPLE_PATH}. Please create it with base account keys.`,
    );
  }
  const raw = fs.readFileSync(EXAMPLE_PATH, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    console.error(
      "Usage: ts-node createSession.ts <network> <rpc_url> <erc20_address>",
    );
    process.exit(1);
  }

  const [network, rpcUrl, erc20Address] = args;

  if (!["sepolia", "mainnet", "devnet"].includes(network as NetworkType)) {
    console.error(
      "Invalid network. Supported networks: sepolia, mainnet, devnet",
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // We use the same deployer account pattern as in cli/deploy.ts
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const deployerAddress = process.env.DEPLOYER_ADDRESS;

  if (!deployerPrivateKey || !deployerAddress) {
    console.error(
      "Missing DEPLOYER_ADDRESS or DEPLOYER_PRIVATE_KEY in env for the caller account",
    );
    process.exit(1);
  }

  const deployer = new Account(
    provider,
    deployerAddress,
    deployerPrivateKey,
    "1",
    "0x3",
  );

  // Braavos account that owns the session and will route calls through __execute__
  const { address: braavosAccountAddress } = readExampleCreds();

  console.log(`Using Braavos account: ${braavosAccountAddress}`);
  console.log(`ERC20 contract to allow: ${erc20Address}`);

  /**
   * Important note:
   * ----------------
   * The Sessions component in Braavos expects:
   * - A first internal call that encodes SessionExecuteRequest(V2)
   * - Following calls that are the actual calls to be executed (e.g. transfer)
   *
   * Constructing the exact SessionExecuteRequest calldata by hand is error‑prone,
   * and your tests already use a known-good example.
   *
   * This script assumes you will provide a precomputed calldata JSON
   * (for example, produced by a Python helper or copied from test logs)
   * with the shape:
   *
   *  {
   *    "calls": [
   *      { "to": "<braavos_account>", "selector": "<session_execute_selector>", "calldata": [...] },
   *      { "to": "<erc20_address>", "selector": "<transfer_selector>", "calldata": [...] }
   *    ]
   *  }
   *
   * For now we read that structure from script/session_payload.json.
   */

  const sessionPayloadPath = path.join(__dirname, "session_payload.json");
  if (!fs.existsSync(sessionPayloadPath)) {
    console.error(
      `Missing session_payload.json at ${sessionPayloadPath}. Please create it with the exact calls you want (__execute__ + transfer).`,
    );
    process.exit(1);
  }

  const sessionPayloadRaw = fs.readFileSync(sessionPayloadPath, "utf8");
  const sessionPayload = JSON.parse(sessionPayloadRaw) as {
    calls: { to: string; selector: string; calldata: string[] }[];
  };

  // Overwrite ERC20 address in the transfer call, in case you want to swap tokens on the fly
  const calls: Call[] = sessionPayload.calls.map((c, idx) => {
    if (idx === 1) {
      // assume 2nd call is ERC20.transfer
      return {
        to: erc20Address,
        selector: c.selector,
        calldata: c.calldata,
      };
    }
    return {
      to: c.to,
      selector: c.selector,
      calldata: c.calldata,
    };
  });

  console.log("Sending session execute transaction via __execute__...");

  try {
    const tx = await deployer.execute(calls, {
      maxFee: "0x0", // rely on fee estimation; account abstraction will handle it
    });
    console.log("Tx submitted:", tx.transaction_hash);

    const receipt = await provider.waitForTransaction(tx.transaction_hash, {
      retryInterval: 5000,
    });

    console.log("Tx status:", receipt.isSuccess ? "SUCCEEDED" : "FAILED");
  } catch (err: any) {
    console.error("Failed to create/execute session:", err?.message ?? err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


