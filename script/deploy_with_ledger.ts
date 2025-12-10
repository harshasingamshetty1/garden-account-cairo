#!/usr/bin/env node
/**
 * deploy_with_ledger.ts
 *
 * Deploys a Braavos account with a Ledger hardware wallet (secp256r1) as the strong signer.
 * The account will require both Stark + Ledger signatures (multisig threshold = 2).
 *
 * Usage:
 *   npx ts-node script/deploy_with_ledger.ts
 *
 * Env (from script/.env):
 *   STARKNET_NODE_URL     - RPC endpoint
 *   DEPLOYER_ADDRESS      - Address of the deployer account (pays for deployment)
 *   DEPLOYER_PRIVATE_KEY  - Private key of the deployer account
 *   CHAIN_ID              - Chain ID (e.g., "0x534e5f5345504f4c4941" for SN_SEPOLIA)
 *
 * Ledger Public Key can be set via:
 *   1. Environment variables: LEDGER_PUBKEY_X_LOW, LEDGER_PUBKEY_X_HIGH, LEDGER_PUBKEY_Y_LOW, LEDGER_PUBKEY_Y_HIGH
 *   2. Or use the defaults below (modify if needed)
 */

import { Account, RpcProvider, ec, hash, stark } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from script folder
const SCRIPT_DIR = path.resolve(process.cwd(), "script");
dotenv.config({ path: path.join(SCRIPT_DIR, ".env") });

// ============================================================================
// Constants
// ============================================================================

// Braavos Factory Address on Starknet Sepolia
const FACTORY_ADDRESS =
  "0x03d94f65eBC7552Eb517DDb374250A9525b605f25F4E41ded6E7d7381Ff1c2e8";

// Braavos Base Account Class Hash (used for address computation)
const BASE_CLASS_HASH =
  "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";

// Braavos Account Implementation Class Hash
const BRAAVOS_ACCOUNT_CLASS_HASH =
  "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";

// SignerType values from src/signers/signer_type.cairo
const SIGNER_TYPE_EMPTY = 0n;
const SIGNER_TYPE_SECP256R1 = 2n;
const SIGNER_TYPE_WEBAUTHN = 5n;

// ============================================================================
// Ledger Hardware Wallet Public Key (Secp256r1)
// ============================================================================
// The secp256r1 public key from Ledger wallet connect
// Format: [x_low, x_high, y_low, y_high] as u128 values
//
// Example Ledger pubkey format:
// {
//   fullPubKey: '0x04031d478514c8dd57aa2b545e438cd69f49900d15c49794271b1ea59965cca623072e4652992187bc1d2b4b8b7c2895ae637a3ead659081727a62803c5836f1c4',
//   x: 1408670722480777916567262936848865565757499882906919507767098460709856257571n,
//   y: 3247950254149146598925159910400333030229561649572518333095701383064013173188n,
//   formatted: {
//     xLow: 97781599835886443527115015074746246691n,
//     xHigh: 4139711191112261906167068758618461855n,
//     yLow: 132228303046748144366458533079095374276n,
//     yHigh: 9544867938760337012122419482010883502n
//   }
// }
//
// Use the 'formatted' values (xLow, xHigh, yLow, yHigh) below or via env vars

// Default Ledger pubkey values - can be overridden via environment variables
const DEFAULT_LEDGER_PUBKEY = {
  xLow: 316014375015636392409984834379964493610,
  xHigh: 310144573268810297409133537301449996926,
  yLow: 162344622597959361756607110293240948193,
  yHigh: 74420976747051812112847075465220094040,
};

// ============================================================================
// Helper Functions
// ============================================================================

function toHex(v: bigint | number | string): string {
  return "0x" + BigInt(v).toString(16);
}

function toFelt(value: bigint | number | string): bigint {
  const felt = BigInt(value);
  const PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
  return felt % PRIME;
}

/**
 * Generate new Stark credentials for the Braavos account
 */
function generateCredentials() {
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = publicKey;
  const constructorCalldata = [publicKey];
  const address = hash.calculateContractAddressFromHash(
    salt,
    BASE_CLASS_HASH,
    constructorCalldata,
    0
  );

  return {
    privateKey,
    publicKey,
    salt,
    constructorCalldata,
    address,
  };
}

/**
 * Build AdditionalDeploymentParams for factory deployment
 *
 * struct AdditionalDeploymentParams {
 *   account_implementation: ClassHash,        // 1
 *   signer_type: SignerType,                  // 2
 *   secp256r1_signer: Secp256r1PubKey,       // 3-6 (x_low, x_high, y_low, y_high)
 *   multisig_threshold: usize,                // 7
 *   withdrawal_limit_low: u128,               // 8
 *   fee_rate: u128,                           // 9
 *   stark_fee_rate: u128,                     // 10
 *   chain_id: felt252,                        // 11
 *   deployment_params_signature: (r, s),      // 12-13
 * }
 */
function buildDeploymentParams(options: {
  signerType: bigint;
  secpXLow: bigint;
  secpXHigh: bigint;
  secpYLow: bigint;
  secpYHigh: bigint;
  multisigThreshold: bigint;
  withdrawalLimit: bigint;
  feeRate: bigint;
  starkFeeRate: bigint;
  chainId: string;
}): bigint[] {
  return [
    BigInt(BRAAVOS_ACCOUNT_CLASS_HASH), // 1 - account_implementation
    options.signerType,                  // 2 - signer_type
    options.secpXLow,                    // 3 - secp256r1_signer.x.low
    options.secpXHigh,                   // 4 - secp256r1_signer.x.high
    options.secpYLow,                    // 5 - secp256r1_signer.y.low
    options.secpYHigh,                   // 6 - secp256r1_signer.y.high
    options.multisigThreshold,           // 7 - multisig_threshold
    options.withdrawalLimit,             // 8 - withdrawal_limit_low
    options.feeRate,                     // 9 - fee_rate
    options.starkFeeRate,                // 10 - stark_fee_rate
    BigInt(options.chainId),             // 11 - chain_id
  ];
}

/**
 * Sign the deployment params with the Stark private key
 */
function signDeploymentParams(
  params: bigint[],
  privateKey: string
): { r: bigint; s: bigint } {
  const normalized = params.map((value) => toFelt(value).toString());
  const payloadHash = hash.computePoseidonHashOnElements(normalized);
  const signature = ec.starkCurve.sign(payloadHash, privateKey);
  return {
    r: BigInt(signature.r),
    s: BigInt(signature.s),
  };
}

/**
 * Build factory calldata for deploy_braavos_account
 */
function buildFactoryCalldata(
  publicKey: string,
  deploymentParams: bigint[],
  signature: { r: bigint; s: bigint }
): string[] {
  const params = [
    ...deploymentParams.map((p) => toHex(p)),
    toHex(signature.r),
    toHex(signature.s),
  ];

  return [publicKey, params.length.toString(), ...params];
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("🚀 Deploying Braavos Account with Ledger Hardware Wallet\n");

  // Load environment
  const rpcUrl = process.env.STARKNET_NODE_URL;
  const deployerAddress = process.env.DEPLOYER_ADDRESS;
  const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const chainId = process.env.CHAIN_ID;

  if (!rpcUrl || !deployerAddress || !deployerPrivateKey || !chainId) {
    console.error(
      "Missing required env vars: STARKNET_NODE_URL, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, CHAIN_ID"
    );
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const deployer = new Account({
    provider,
    address: deployerAddress,
    signer: deployerPrivateKey,
  });

  // Generate new Stark credentials for the Braavos account
  const creds = generateCredentials();
  console.log(`📍 New Braavos Account Address: ${creds.address}`);
  console.log(`🔑 Stark Public Key: ${creds.publicKey}`);



  // Build deployment params (WITHOUT signature)
  // NOTE: Deploy with only Stark signer initially (signerType: EMPTY)
  // The Ledger (secp256r1) signer will be added as a second signer AFTER deployment
  const deploymentParams = buildDeploymentParams({
    signerType: SIGNER_TYPE_SECP256R1,
    secpXLow: DEFAULT_LEDGER_PUBKEY.xLow,
    secpXHigh: DEFAULT_LEDGER_PUBKEY.xHigh,
    secpYLow: DEFAULT_LEDGER_PUBKEY.yLow,
    secpYHigh: DEFAULT_LEDGER_PUBKEY.yHigh,
    multisigThreshold: 2n, // Require both Stark + Ledger
    withdrawalLimit: 0n,
    feeRate: 0n,
    starkFeeRate: 0n,
    chainId,
  });

  console.log("=== Deployment Params (pre-signature) ===");
  deploymentParams.forEach((p, i) => {
    console.log(`  [${i}] ${toHex(p)}`);
  });

  // Sign the params with the new Braavos account's Stark key
  const signature = signDeploymentParams(deploymentParams, creds.privateKey);
  console.log(`\n🔏 Signature:`);
  console.log(`  r: ${toHex(signature.r)}`);
  console.log(`  s: ${toHex(signature.s)}`);

  // Build factory calldata
  const calldata = buildFactoryCalldata(creds.publicKey, deploymentParams, signature);

  console.log(`\n=== Factory Calldata ===`);
  console.log(`Total length: ${calldata.length}`);
  console.log(`Public Key: ${creds.publicKey}`);
  console.log(`Params length: ${deploymentParams.length + 2}`);

  // Execute deployment via factory
  console.log("\n⏳ Submitting deployment transaction...");

  try {
    const { transaction_hash } = await deployer.execute({
      contractAddress: FACTORY_ADDRESS,
      entrypoint: "deploy_braavos_account",
      calldata,
    });

    console.log(`✅ Transaction submitted: ${transaction_hash}`);
    console.log("⏳ Waiting for confirmation...\n");

    const receipt = await provider.waitForTransaction(transaction_hash, {
      retryInterval: 5000,
    });

    const success =
      typeof receipt.isSuccess === "function"
        ? receipt.isSuccess()
        : receipt.isSuccess;

    if (!success) {
      throw new Error("Transaction failed");
    }

    // Verify class hash
    const classHash = await provider.getClassHashAt(creds.address);
    console.log(`✅ Deployment successful!`);
    console.log(`\n=== Deployed Account Details ===`);
    console.log(`Address: ${creds.address}`);
    console.log(`Class Hash: ${classHash}`);
    console.log(`Transaction: ${transaction_hash}`);

    // Save credentials
    const outputPath = path.join(SCRIPT_DIR, "deployed_ledger_account.json");
    const outputData = {
      address: creds.address,
      starkPrivateKey: creds.privateKey,
      starkPublicKey: creds.publicKey,
      classHash,
      transactionHash: transaction_hash,
      ledgerPubKey: {
        xLow: DEFAULT_LEDGER_PUBKEY.xLow.toString(),
        xHigh: DEFAULT_LEDGER_PUBKEY.xHigh.toString(),
        yLow: DEFAULT_LEDGER_PUBKEY.yLow.toString(),
        yHigh: DEFAULT_LEDGER_PUBKEY.yHigh.toString(),
      },
      deployedWith: "Stark signer only",
      nextSteps: "Run add_secp256r1_signer to add Ledger as second signer",
    };

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`\n📁 Credentials saved to: ${outputPath}`);

    console.log("\n=== NEXT STEPS ===");
    console.log("✅ Account deployed with Stark signer");
    console.log("\nTo add Ledger as second signer (multisig threshold 2):");
    console.log(`  1. Run: npx ts-node script/add_secp256r1_signer.ts`);
    console.log(`  2. This will add the Ledger public key as a second signer`);
    console.log(`  3. Then set multisig threshold to 2\n`);
    console.log("Ledger Public Key (secp256r1):");
    console.log(`  x: ${toHex(DEFAULT_LEDGER_PUBKEY.xLow)} (low), ${toHex(DEFAULT_LEDGER_PUBKEY.xHigh)} (high)`);
    console.log(`  y: ${toHex(DEFAULT_LEDGER_PUBKEY.yLow)} (low), ${toHex(DEFAULT_LEDGER_PUBKEY.yHigh)} (high)`);
  } catch (err: any) {
    console.error("\n❌ Deployment failed:", err?.message ?? err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

