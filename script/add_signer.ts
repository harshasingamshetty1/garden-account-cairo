#!/usr/bin/env node
import { Account, RpcProvider } from "starknet";
import * as dotenv from "dotenv";

dotenv.config();

type NetworkType = "sepolia" | "mainnet" | "devnet";

// SignerType values from src/signers/signer_type.cairo
const SECP256R1_SIGNER_TYPE = 2n;
const WEBAUTHN_SIGNER_TYPE = 5n;

function splitUint256(value: bigint): { low: bigint; high: bigint } {
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;
  return { low, high };
}

function toHex(v: bigint): string {
  return "0x" + v.toString(16);
}

function cleanHex(input: string): string {
  return input.startsWith("0x") || input.startsWith("0X")
    ? input.slice(2)
    : input;
}

/**
 * Derive (x, y) from a combined uncompressed secp256r1 pubkey.
 *
 * Expected format: 0x + 128 hex chars (64 for x, 64 for y), or just 128 hex chars.
 */
function deriveXYFromPubKey(pubKey: string): { x: bigint; y: bigint } {
  const hex = cleanHex(pubKey);
  if (hex.length !== 128) {
    throw new Error(
      `ADDED_PUBKEY must be 128 hex chars (64 for x, 64 for y), got length=${hex.length}`,
    );
  }
  const xHex = hex.slice(0, 64);
  const yHex = hex.slice(64);
  const x = BigInt("0x" + xHex);
  const y = BigInt("0x" + yHex);
  return { x, y };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error(
      "Usage: ts-node add_signer.ts <network> <rpc_url>\n" +
        "Env required: BRAAVOS_ACCOUNT_ADDRESS, DEPLOYER_PRIVATE_KEY, " +
        "ADDED_SECP_X, ADDED_SECP_Y, [ADDED_SIGNER_TYPE=secp256r1|webauthn], [MULTISIG_THRESHOLD]",
    );
    process.exit(1);
  }

  const [network, rpcUrl] = args;

  if (!["sepolia", "mainnet", "devnet"].includes(network as NetworkType)) {
    console.error(
      "Invalid network. Supported networks: sepolia, mainnet, devnet",
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  const braavosAddress =
    process.env.BRAAVOS_ACCOUNT_ADDRESS ??
    "0x016fa2845c31a5a262F147163a7a2b5F7376512daf6B7244Fdb6FEb084865Fd8";

  const accountPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!braavosAddress || !accountPrivateKey) {
    console.error(
      "Missing BRAAVOS_ACCOUNT_ADDRESS or DEPLOYER_PRIVATE_KEY in env",
    );
    process.exit(1);
  }

  // New strong signer secp256r1 public key.
  // You can either:
  // - provide ADDED_SECP_X and ADDED_SECP_Y (as decimal or hex), OR
  // - provide ADDED_PUBKEY as a single 0x... string (x||y, 64 hex chars each).
  const addedX = process.env.ADDED_SECP_X;
  const addedY = process.env.ADDED_SECP_Y;
  const addedPubKey = process.env.ADDED_PUBKEY;

  if ((!addedX || !addedY) && !addedPubKey) {
    console.error(
      "Provide either (ADDED_SECP_X and ADDED_SECP_Y) or ADDED_PUBKEY in env for the signer public key",
    );
    process.exit(1);
  }

  const addedSignerTypeEnv = process.env.ADDED_SIGNER_TYPE ?? "secp256r1";
  const signerTypeFelt =
    addedSignerTypeEnv.toLowerCase() === "webauthn"
      ? WEBAUTHN_SIGNER_TYPE
      : SECP256R1_SIGNER_TYPE;

  // Multisig threshold rules (see multisig.cairo):
  // - 0 means "no change"
  // - Allowed values are 0 or 2..num_signers (1 is invalid -> INVALID_MULTISIG_THRESHOLD)
  // Use 0 by default to avoid changing multisig when adding a signer.
  const multisigThreshold =
    BigInt(process.env.MULTISIG_THRESHOLD ?? "0") || 0n;

  const account = new Account({
    provider,
    address: braavosAddress,
    signer: accountPrivateKey,
  });

  console.log(`Using Braavos account: ${braavosAddress}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(
    addedPubKey
      ? `Adding ${addedSignerTypeEnv} signer from ADDED_PUBKEY=${addedPubKey}`
      : `Adding ${addedSignerTypeEnv} signer with pub_x=${addedX}, pub_y=${addedY}`,
  );

  const { x: xBig, y: yBig } = addedPubKey
    ? deriveXYFromPubKey(addedPubKey)
    : { x: BigInt(addedX as string), y: BigInt(addedY as string) };
  const { low: xLow, high: xHigh } = splitUint256(xBig);
  const { low: yLow, high: yHigh } = splitUint256(yBig);

  // Secp256r1PubKey (u256 x, u256 y) is flattened to 4 felts:
  // [x.low, x.high, y.low, y.high], then signer_type, then multisig_threshold
  const calldata = [
    toHex(xLow),
    toHex(xHigh),
    toHex(yLow),
    toHex(yHigh),
    toHex(signerTypeFelt),
    toHex(multisigThreshold),
  ];

  try {
    const tx = await account.execute([
      {
        contractAddress: braavosAddress,
        entrypoint: "add_secp256r1_signer",
        calldata,
      },
    ]);

    console.log("Tx submitted:", tx.transaction_hash);
    const receipt = await provider.waitForTransaction(tx.transaction_hash);
    console.log("Tx receipt:", receipt);
  } catch (err: any) {
    console.error("Failed to add signer:", err?.message ?? err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


