#!/usr/bin/env node
/**
 * create_session.ts
 *
 * This script creates a Braavos session that grants a specific address
 * (the "session caller") the ability to call a specific function on a
 * specific contract (e.g., `transfer` on STRK token).
 *
 * Session Type: **GasSponsoredSession** (caller pays gas)
 *   - Account owner signs the session hash with their Stark key.
 *   - Session caller can then call `execute_gas_sponsored_session_tx`
 *     on the Braavos account with the session request + signature.
 *
 * Usage:
 *   npx ts-node script/create_session.ts
 *
 * Env (required):
 *   BRAAVOS_ACCOUNT_ADDRESS      - The Braavos account granting the session
 *   BRAAVOS_ACCOUNT_PRIVATE_KEY  - Stark private key of the Braavos account owner
 *   DEPLOYER_ADDRESS             - Address of the session caller (who will execute)
 *   TARGET_CONTRACT              - Contract address the session can call (e.g., STRK token)
 *
 * Env (optional):
 *   TARGET_SELECTOR          - Function selector (default: "transfer")
 *   SESSION_CALLER_ADDRESS   - Address that can execute the session (default: DEPLOYER_ADDRESS)
 *   EXECUTE_AFTER            - Unix timestamp after which session is valid (default: now - 1 hour)
 *   EXECUTE_BEFORE           - Unix timestamp before which session is valid (default: now + 10 years)
 *   SPENDING_LIMIT_TOKEN     - Token address for spending limit
 *   SPENDING_LIMIT_AMOUNT    - Max amount for spending limit
 */

import { Account, RpcProvider, ec, hash, num, shortString, typedData } from "starknet";
import type { TypedData } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const configDir = path.join(process.cwd(), "script");
dotenv.config({ path: path.join(configDir, ".env") });

// Get script directory - works in both CommonJS and ESM
const SCRIPT_DIR = path.resolve(process.cwd(), "script");

// ============================================================================
// Session caller configuration
// ============================================================================
// The session caller is any Starknet account that will execute the session.
// Set SESSION_CALLER_ADDRESS in env, or it defaults to DEPLOYER_ADDRESS.

type NetworkType = "sepolia" | "mainnet" | "devnet";

// 10 years in seconds
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function toUint256(value: bigint): { low: number; high: number } {
  const mask = (1n << 128n) - 1n;
  return {
    low: Number(value & mask),
    high: Number(value >> 128n),
  };
}

/**
 * Build SNIP-12 TypedData for GasSponsoredSessionExecution (V1)
 * Matches the Python test implementation exactly
 */
function buildGasSponsoredSessionTypedData(params: {
  chainId: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{ contractAddress: string; selector: string }>;
  spendingLimits: Array<{ tokenAddress: string; amount: bigint }>;
}): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      GasSponsoredSessionExecution: [
        { name: "Caller", type: "ContractAddress" },
        { name: "Execute After", type: "timestamp" },
        { name: "Execute Before", type: "timestamp" },
        { name: "Allowed Methods", type: "AllowedMethod*" },
        { name: "Spending Limits", type: "TokenAmount*" },
      ],
      AllowedMethod: [
        { name: "Contract Address", type: "ContractAddress" },
        { name: "Selector", type: "selector" },
      ],
    },
    primaryType: "GasSponsoredSessionExecution",
    domain: {
      name: "Account.execute_gs_session",
      version: "2",
      chainId: params.chainId,
      revision: "1",
    },
    message: {
      Caller: params.caller,
      "Execute After": params.executeAfter,
      "Execute Before": params.executeBefore,
      "Allowed Methods": params.allowedMethods.map((m) => ({
        "Contract Address": m.contractAddress,
        Selector: m.selector.startsWith("0x")
          ? m.selector
          : hash.getSelectorFromName(m.selector),
      })),
      "Spending Limits": params.spendingLimits.map((l) => ({
        token_address: l.tokenAddress,
        amount: toUint256(l.amount),
      })),
    },
  };
}

/**
 * Compute allowed method GUID using TypedData encoding
 */
function computeAllowedMethodGuid(
  contractAddress: string,
  selector: string,
  chainId: string,
): string {
  // For V1, AllowedMethod has just Contract Address and Selector
  const selectorHex = selector.startsWith("0x")
    ? selector
    : hash.getSelectorFromName(selector);

  // The GUID is the Poseidon hash of [type_hash, contract_address, selector]
  const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
  );

  return hash.computePoseidonHashOnElements([
    ALLOWED_METHOD_TYPE_HASH,
    contractAddress,
    selectorHex,
  ]);
}

async function main() {
  const args = process.argv.slice(2);

  // Default to Starknet Sepolia
  let network: NetworkType = "sepolia";
  let rpcUrl = process.env.STARKNET_NODE_URL;

  if (args.length === 2) {
    network = args[0] as NetworkType;
    rpcUrl = args[1];
  } else if (args.length === 1) {
    console.error(
      "Usage: ts-node create_session.ts [network] [rpc_url]\n" +
        "Defaults to sepolia if no args provided.\n" +
        "Env: BRAAVOS_ACCOUNT_ADDRESS, DEPLOYER_PRIVATE_KEY, TARGET_CONTRACT, TARGET_SELECTOR",
    );
    process.exit(1);
  }

  if (!["sepolia", "mainnet", "devnet"].includes(network)) {
    console.error(
      "Invalid network. Supported networks: sepolia, mainnet, devnet",
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // Read Braavos account credentials from env
  // The session must be signed by the Braavos account owner's key
  const braavosAddress = process.env.BRAAVOS_ACCOUNT_ADDRESS;
  const braavosPrivateKey = process.env.BRAAVOS_ACCOUNT_PRIVATE_KEY;

  if (!braavosAddress || !braavosPrivateKey) {
    console.error(
      "Missing BRAAVOS_ACCOUNT_ADDRESS or BRAAVOS_ACCOUNT_PRIVATE_KEY in env.\n" +
      "These are the credentials of the Braavos account granting the session.",
    );
    process.exit(1);
  }

  console.log(`\n🔐 Braavos Account (granting session): ${braavosAddress}`);

  // Session caller: the account that will execute the session
  // Defaults to DEPLOYER_ADDRESS
  const sessionCaller = process.env.SESSION_CALLER_ADDRESS ?? process.env.DEPLOYER_ADDRESS;
  
  if (!sessionCaller) {
    console.error(
      "Missing SESSION_CALLER_ADDRESS or DEPLOYER_ADDRESS in env.\n" +
      "This is the address that will be authorized to execute the session.",
    );
    process.exit(1);
  }
  
  console.log(`📄 Session Caller (authorized to execute): ${sessionCaller}`);

  const targetContract = process.env.TARGET_CONTRACT;
  const targetSelector = process.env.TARGET_SELECTOR ?? "transfer";

  if (!targetContract) {
    console.error("Missing TARGET_CONTRACT in env (the contract the session can call)");
    process.exit(1);
  }

  // We use GasSponsoredSession - the session caller pays gas

  const now = Math.floor(Date.now() / 1000);
  // Default: start 1 hour ago (to account for clock drift)
  const executeAfter = Number(process.env.EXECUTE_AFTER ?? now - 3600);
  // Default: expire in 10 years (effectively indefinite)
  const executeBefore = Number(
    process.env.EXECUTE_BEFORE ?? now + TEN_YEARS_SECONDS,
  );

  const spendingLimits: Array<{ tokenAddress: string; amount: bigint }> = [];
  if (process.env.SPENDING_LIMIT_TOKEN && process.env.SPENDING_LIMIT_AMOUNT) {
    spendingLimits.push({
      tokenAddress: process.env.SPENDING_LIMIT_TOKEN,
      amount: BigInt(process.env.SPENDING_LIMIT_AMOUNT),
    });
  }

  // Get chain ID
  const chainId = await provider.getChainId();

  // Build the TypedData for SNIP-12 signing
  const sessionTypedData = buildGasSponsoredSessionTypedData({
    chainId,
    caller: sessionCaller,
    executeAfter,
    executeBefore,
    allowedMethods: [{ contractAddress: targetContract, selector: targetSelector }],
    spendingLimits,
  });

  // Compute allowed method GUID
  const allowedMethodGuid = computeAllowedMethodGuid(
    targetContract,
    targetSelector,
    chainId,
  );

  console.log("\n=== Session Configuration ===");
  console.log(`Network: ${network}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Braavos Account (granting session): ${braavosAddress}`);
  console.log(`Session Caller (can execute): ${sessionCaller}`);
  console.log(`Target Contract: ${targetContract}`);
  console.log(`Target Selector: ${targetSelector}`);
  console.log(`Allowed Method GUID: ${allowedMethodGuid}`);
  console.log(`Execute After: ${executeAfter} (${new Date(executeAfter * 1000).toISOString()})`);
  console.log(`Execute Before: ${executeBefore} (${new Date(executeBefore * 1000).toISOString()})`);
  console.log(`Spending Limits: ${JSON.stringify(spendingLimits)}`);
  console.log(`Chain ID: ${chainId}`);

  // We use GasSponsoredSession
  const sessionType = "GasSponsoredSession";
  console.log(`\nSession Type: ${sessionType}`);

  // Compute session hash using SNIP-12 TypedData
  const sessionHash = typedData.getMessageHash(sessionTypedData, braavosAddress);

  console.log(`\nSession Hash: ${sessionHash}`);

  // Sign the session hash with the Braavos account owner's Stark key
  const signature = ec.starkCurve.sign(sessionHash, braavosPrivateKey);
  const signatureR = toHex(signature.r);
  const signatureS = toHex(signature.s);

  console.log(`\nSignature:`);
  console.log(`  r: ${signatureR}`);
  console.log(`  s: ${signatureS}`);

  // Build session JSON
  const selectorHex = targetSelector.startsWith("0x")
    ? targetSelector
    : hash.getSelectorFromName(targetSelector);

  // Store session caller's private key for execute_session.ts
  const sessionCallerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
  if (!sessionCallerPrivateKey) {
    console.warn(
      "⚠️  Warning: DEPLOYER_PRIVATE_KEY not set. execute_session.ts will need it to execute.",
    );
  }

  const sessionData = {
    sessionType,
    braavosAccountAddress: braavosAddress,
    chainId,
    sessionHash,
    executeAfter: executeAfter.toString(),
    executeBefore: executeBefore.toString(),
    sessionCaller,
    sessionCallerPrivateKey,
    allowedMethods: [
      {
        contractAddress: targetContract,
        selector: targetSelector,
        selectorHex,
        guid: allowedMethodGuid,
      },
    ],
    spendingLimits: spendingLimits.map((l) => ({
      tokenAddress: l.tokenAddress,
      amount: l.amount.toString(),
    })),
    signature: {
      r: signatureR,
      s: signatureS,
    },
  };

  const outputPath = path.join(SCRIPT_DIR, "session_data.json");
  fs.writeFileSync(outputPath, JSON.stringify(sessionData, null, 2));
  console.log(`\n✅ Session data saved to: ${outputPath}`);

  console.log("\n=== How to use this session ===");
  console.log(`
1. The caller at address ${sessionCaller} can now execute transactions
   on the Braavos account (gas sponsored by the caller).

2. To execute, the caller calls execute_gas_sponsored_session_tx on the Braavos account:
   
   braavosAccount.execute_gas_sponsored_session_tx(
     GasSponsoredSessionExecutionRequest {
       execute_after: ${executeAfter},
       execute_before: ${executeBefore},
       allowed_method_guids: [${allowedMethodGuid}],
       spending_limits: [...],
       calls: [{ to: "${targetContract}", selector: "${targetSelector}", calldata: [...] }],
       call_hints: [0],
     },
     signature: [${signatureR}, ${signatureS}]
   )

3. Run execute_session.ts to execute the session:
   npx ts-node script/execute_session.ts
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

