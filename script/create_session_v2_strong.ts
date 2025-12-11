#!/usr/bin/env node
/**
 * create_session_v2_strong.ts
 *
 * Creates a V2 GasSponsoredSession with calldata validation (restricted to
 * transfer amount = 1 STRK) but signs the session hash with a **strong**
 * secp256r1 signer instead of the Stark key.
 *
 * Output: script/session_data_v2_strong.json
 *
 * Usage:
 *   npx ts-node script/create_session_v2_strong.ts [network] [rpc_url]
 *   Defaults to: network = sepolia, rpc = STARKNET_NODE_URL
 *
 * Required env:
 *   BRAAVOS_ACCOUNT_ADDRESS      - Braavos account granting the session
 *   SECP256R1_PRIVATE_KEY        - Strong signer private key (hex, 32 bytes)
 *   SECP256R1_PUBKEY (optional)  - Uncompressed pubkey (0x04 + 128 hex). If
 *                                   omitted, derived from the private key.
 *   SESSION_CALLER_ADDRESS or DEPLOYER_ADDRESS - account allowed to execute
 *   TARGET_CONTRACT              - Contract to call (e.g., STRK token address)
 *
 * Optional env:
 *   TARGET_SELECTOR  - Entrypoint selector (default: "transfer")
 *   EXECUTE_AFTER    - Unix timestamp session start (default: now - 1h)
 *   EXECUTE_BEFORE   - Unix timestamp session end   (default: now + 10y)
 *   STARKNET_NODE_URL- RPC URL if not passed as arg
 */

import { RpcProvider, hash, typedData } from "starknet";
import type { TypedData } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const configDir = path.join(process.cwd(), "script");
dotenv.config({ path: path.join(configDir, ".env") });

const SCRIPT_DIR = path.resolve(process.cwd(), "script");

type NetworkType = "sepolia" | "mainnet" | "devnet";

const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;
const ONE_STRK = 1000000000000000000n; // 1e18
const NINE_STRK = 9n * ONE_STRK;       // spending limit
const SECP256R1_SIGNER_TYPE = 2n;

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function splitU256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  return {
    low: value & mask,
    high: value >> 128n,
  };
}

function cleanHex(input: string): string {
  return input.startsWith("0x") || input.startsWith("0X") ? input.slice(2) : input;
}

/**
 * Normalize an uncompressed secp256r1 pubkey.
 * Accepts:
 *  - 0x04 + 128 hex chars
 *  - 0x + 128 hex chars (without 04)
 *  - 128 hex chars
 */
function normalizeUncompressedPubKey(pubKey: string): string {
  let cleaned = cleanHex(pubKey);
  if (cleaned.startsWith("04")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length !== 128) {
    throw new Error(
      `Invalid SECP256R1_PUBKEY length. Expected 128 hex chars (x||y), got ${cleaned.length}`,
    );
  }
  return "0x04" + cleaned;
}

function extractXYFromPubKey(pubKey: string): { x: bigint; y: bigint } {
  const normalized = normalizeUncompressedPubKey(pubKey);
  const withoutPrefix = normalized.slice(4); // remove 0x04
  const xHex = withoutPrefix.slice(0, 64);
  const yHex = withoutPrefix.slice(64);
  return {
    x: BigInt("0x" + xHex),
    y: BigInt("0x" + yHex),
  };
}

async function deriveSecp256r1PubKey(privateKeyHex: string): Promise<string> {
  const cleaned = cleanHex(privateKeyHex);
  if (cleaned.length !== 64) {
    throw new Error(
      `SECP256R1_PRIVATE_KEY must be 32 bytes (64 hex chars). Got length=${cleaned.length}`,
    );
  }

  // Dynamic import to avoid type issues if package is CJS
  // @ts-ignore
  const secpModule = await import("secp256r1");
  const secp = secpModule.default ?? secpModule;
  const privBytes = Buffer.from(cleaned, "hex");
  const pubKeyBuf: Buffer = secp.publicKeyCreate(privBytes, false); // uncompressed (65 bytes, starts with 0x04)
  return "0x" + pubKeyBuf.toString("hex");
}

/**
 * Sign the session hash with secp256r1 (strong signer).
 * The hash is treated as a 32-byte message (no extra hashing).
 */
async function signSessionHashSecp256r1(
  sessionHash: string,
  privateKeyHex: string,
): Promise<{ r: bigint; s: bigint }> {
  const cleanedPriv = cleanHex(privateKeyHex);
  if (cleanedPriv.length !== 64) {
    throw new Error(
      `SECP256R1_PRIVATE_KEY must be 32 bytes (64 hex chars). Got length=${cleanedPriv.length}`,
    );
  }

  const hashHex = cleanHex(sessionHash).padStart(64, "0"); // ensure 32 bytes
  const msgBuffer = Buffer.from(hashHex, "hex");
  if (msgBuffer.length !== 32) {
    throw new Error(`Session hash must be 32 bytes. Got ${msgBuffer.length} bytes`);
  }

  // @ts-ignore
  const secpModule = await import("secp256r1");
  const secp = secpModule.default ?? secpModule;
  const privBytes = Buffer.from(cleanedPriv, "hex");
  if (privBytes.length !== 32) {
    throw new Error(`Private key must be 32 bytes. Got ${privBytes.length} bytes`);
  }

  const sigResult = secp.sign(msgBuffer, privBytes);
  const sigBuffer: Buffer = sigResult.signature ?? sigResult;

  if (!Buffer.isBuffer(sigBuffer) || sigBuffer.length !== 64) {
    throw new Error(
      `Invalid secp256r1 signature. Expected 64 bytes (r||s), got ${sigBuffer?.length ?? "unknown"}`,
    );
  }

  const r = BigInt("0x" + sigBuffer.slice(0, 32).toString("hex"));
  const s = BigInt("0x" + sigBuffer.slice(32).toString("hex"));
  return { r, s };
}

/**
 * Build SNIP-12 TypedData for GasSponsoredSessionExecution V2
 * V2 includes CalldataValidations in AllowedMethod
 */
function buildGasSponsoredSessionTypedDataV2(params: {
  chainId: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
    calldataValidations: Array<{ offset: number; value: string; validationType: number }>;
  }>;
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
        { name: "Calldata Validations", type: "CalldataValidation*" },
      ],
      CalldataValidation: [
        { name: "Offset", type: "u128" },
        { name: "Value", type: "felt" },
        { name: "Validation Type", type: "u128" },
      ],
      TokenAmount: [
        { name: "token_address", type: "ContractAddress" },
        { name: "amount", type: "u256" },
      ],
      u256: [
        { name: "low", type: "u128" },
        { name: "high", type: "u128" },
      ],
    },
    primaryType: "GasSponsoredSessionExecution",
    domain: {
      name: "Account.execute_gs_session",
      version: "3", // V2 uses domain version 3
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
        "Calldata Validations": m.calldataValidations.map((cv) => ({
          Offset: cv.offset,
          Value: cv.value,
          "Validation Type": cv.validationType,
        })),
      })),
      "Spending Limits": params.spendingLimits.map((l) => {
        const { low, high } = splitU256(l.amount);
        return {
          token_address: l.tokenAddress,
          amount: {
            low: Number(low),
            high: Number(high),
          },
        };
      }),
    },
  };
}

/**
 * Compute allowed method GUID for V2 (includes calldata validations)
 */
function computeAllowedMethodGuidV2(
  contractAddress: string,
  selector: string,
  calldataValidations: Array<{ offset: number; value: string; validationType: number }>,
): string {
  const selectorHex = selector.startsWith("0x")
    ? selector
    : hash.getSelectorFromName(selector);

  // V2 AllowedMethod type hash
  const ALLOWED_METHOD_TYPE_HASH_V2 = hash.getSelectorFromName(
    '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  // Hash calldata validations
  const CALLDATA_VALIDATION_TYPE_HASH = hash.getSelectorFromName(
    '"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
  );

  const hashedValidations = calldataValidations.map((cv) =>
    hash.computePoseidonHashOnElements([
      CALLDATA_VALIDATION_TYPE_HASH,
      cv.offset.toString(),
      cv.value,
      cv.validationType.toString(),
    ]),
  );

  const calldataValidationsHash = hash.computePoseidonHashOnElements(hashedValidations);

  return hash.computePoseidonHashOnElements([
    ALLOWED_METHOD_TYPE_HASH_V2,
    contractAddress,
    selectorHex,
    calldataValidationsHash,
  ]);
}

async function main() {
  const args = process.argv.slice(2);

  let network: NetworkType = "sepolia";
  let rpcUrl = process.env.STARKNET_NODE_URL;

  if (args.length === 2) {
    network = args[0] as NetworkType;
    rpcUrl = args[1];
  }

  if (!["sepolia", "mainnet", "devnet"].includes(network)) {
    console.error("Invalid network. Supported: sepolia, mainnet, devnet");
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  const braavosAddress = process.env.BRAAVOS_ACCOUNT_ADDRESS;
  if (!braavosAddress) {
    console.error("Missing BRAAVOS_ACCOUNT_ADDRESS in env");
    process.exit(1);
  }

  // Strong signer (secp256r1)
  const secpPrivKey =
    process.env.SECP256R1_PRIVATE_KEY ??
    process.env.SECP256R1_PrIvate_key ?? // fallback for inconsistent casing
    process.env.secp256r1_PrIvate_key;

  if (!secpPrivKey) {
    console.error("Missing SECP256R1_PRIVATE_KEY in env");
    process.exit(1);
  }

  const providedPubKey = process.env.SECP256R1_PUBKEY;

  const sessionCaller = process.env.SESSION_CALLER_ADDRESS ?? process.env.DEPLOYER_ADDRESS;
  if (!sessionCaller) {
    console.error("Missing SESSION_CALLER_ADDRESS or DEPLOYER_ADDRESS in env");
    process.exit(1);
  }

  const targetContract = process.env.TARGET_CONTRACT;
  const targetSelector = process.env.TARGET_SELECTOR ?? "transfer";
  if (!targetContract) {
    console.error("Missing TARGET_CONTRACT in env");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const executeAfter = Number(process.env.EXECUTE_AFTER ?? now - 3600);
  const executeBefore = Number(process.env.EXECUTE_BEFORE ?? now + TEN_YEARS_SECONDS);

  const chainId = await provider.getChainId();

  // Calldata validations: restrict amount to exactly 1 STRK
  const { low: amountLow, high: amountHigh } = splitU256(ONE_STRK);
  const calldataValidations = [
    { offset: 1, value: toHex(amountLow), validationType: 0 }, // amount.low = 1e18
    { offset: 2, value: toHex(amountHigh), validationType: 0 }, // amount.high = 0
  ];

  const spendingLimits = [{ tokenAddress: targetContract, amount: NINE_STRK }];

  const sessionTypedData = buildGasSponsoredSessionTypedDataV2({
    chainId,
    caller: sessionCaller,
    executeAfter,
    executeBefore,
    allowedMethods: [
      {
        contractAddress: targetContract,
        selector: targetSelector,
        calldataValidations,
      },
    ],
    spendingLimits,
  });

  const allowedMethodGuid = computeAllowedMethodGuidV2(
    targetContract,
    targetSelector,
    calldataValidations,
  );

  console.log("\n=== V2 Session Configuration (strong signer) ===");
  console.log(`Network: ${network}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Braavos Account: ${braavosAddress}`);
  console.log(`Session Caller: ${sessionCaller}`);
  console.log(`Target Contract: ${targetContract}`);
  console.log(`Target Selector: ${targetSelector}`);
  console.log(`Allowed Method GUID (V2): ${allowedMethodGuid}`);
  console.log(`Execute After: ${executeAfter}`);
  console.log(`Execute Before: ${executeBefore}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Calldata Validations -> amount must equal 1 STRK (1e18)`);
  console.log(`Spending Limit -> 9 STRK total`);

  const sessionType = "GasSponsoredSessionV2";
  const sessionHash = typedData.getMessageHash(sessionTypedData, braavosAddress);
  console.log(`\nSession Hash: ${sessionHash}`);

  // Strong signer public key
  const derivedPubKey = await deriveSecp256r1PubKey(secpPrivKey);
  const normalizedDerived = normalizeUncompressedPubKey(derivedPubKey);
  let normalizedPubKey = normalizedDerived;
  if (providedPubKey) {
    const normalizedProvided = normalizeUncompressedPubKey(providedPubKey);
    if (normalizedProvided.toLowerCase() !== normalizedDerived.toLowerCase()) {
      throw new Error(
        `Provided SECP256R1_PUBKEY does not match the private key.\n` +
          `Derived : ${normalizedDerived}\n` +
          `Provided: ${normalizedProvided}`,
      );
    }
    normalizedPubKey = normalizedProvided;
  }

  const { x: pubX, y: pubY } = extractXYFromPubKey(normalizedPubKey);
  const { low: xLow, high: xHigh } = splitU256(pubX);
  const { low: yLow, high: yHigh } = splitU256(pubY);

  // Sign with secp256r1 strong signer
  const { r, s } = await signSessionHashSecp256r1(sessionHash, secpPrivKey);
  const { low: rLow, high: rHigh } = splitU256(r);
  const { low: sLow, high: sHigh } = splitU256(s);

  console.log("\n=== Strong Signer (secp256r1) ===");
  console.log(`PubKey x: ${toHex(pubX)}`);
  console.log(`PubKey y: ${toHex(pubY)}`);
  console.log(`Signature r: ${toHex(r)}`);
  console.log(`Signature s: ${toHex(s)}`);

  const selectorHex = targetSelector.startsWith("0x")
    ? targetSelector
    : hash.getSelectorFromName(targetSelector);

  const sessionCallerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";

  const sessionData = {
    sessionType,
    sessionVersion: "V2",
    signerType: "secp256r1",
    signerTypeFelt: SECP256R1_SIGNER_TYPE.toString(),
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
        calldataValidations: calldataValidations.map((cv) => ({
          offset: cv.offset,
          value: cv.value,
          validationType: cv.validationType,
        })),
      },
    ],
    spendingLimits: spendingLimits.map((l) => ({
      tokenAddress: l.tokenAddress,
      amount: l.amount.toString(),
    })),
    restrictedAmount: ONE_STRK.toString(),
    signature: {
      type: "secp256r1",
      signerTypeFelt: SECP256R1_SIGNER_TYPE.toString(),
      pubKey: {
        uncompressed: normalizedPubKey,
        x: toHex(pubX),
        y: toHex(pubY),
      },
      sig: {
        r: toHex(r),
        s: toHex(s),
      },
    },
    signatureCalldata: [
      "9", // length
      SECP256R1_SIGNER_TYPE.toString(),
      toHex(xLow),
      toHex(xHigh),
      toHex(yLow),
      toHex(yHigh),
      toHex(rLow),
      toHex(rHigh),
      toHex(sLow),
      toHex(sHigh),
    ],
  };

  const outputPath = path.join(SCRIPT_DIR, "session_data_v2_strong.json");
  fs.writeFileSync(outputPath, JSON.stringify(sessionData, null, 2));
  console.log(`\n✅ V2 (strong signer) session data saved to: ${outputPath}`);

  console.log(`
=== Next steps ===
1) Ensure the secp256r1 public key is already added to the Braavos account
   (use script/add_signer.ts if needed).
2) Execute the session (1 STRK transfer, should succeed):
   npx ts-node script/execute_session_1stark_strong.ts
3) Use script/execute_session_2stark.ts to confirm 2 STRK fails (calldata validation).
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

