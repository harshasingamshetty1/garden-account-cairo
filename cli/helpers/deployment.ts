import { CallData, ec, hash, provider } from "starknet";
import {
  BRAAVOS_ACCOUNT_CLASS_HASH,
  config,
  STARKNET_TOKEN_ADDRESS,
} from "../config";
import { DeploymentParamsOptions, DeploymentSignerType } from "../types";
import { deployer, splitUint128, toFelt } from "../utils";

/**
 * Build deployment parameters for Braavos account (WITHOUT signature)
 * Maps to AdditionalDeploymentParams struct (minus the signature field)
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
 *   deployment_params_signature: (felt252, felt252), // Will be added after signing
 * }
 *
 * Returns 11 parameters (signature r, s added separately after signing)
 */
export function buildDeploymentParams(
  options: DeploymentParamsOptions,
): bigint[] {
  const secpX = options.secpX || 0n;
  const secpY = options.secpY || 0n;

  // Set signer type to Secp256r1 if secp256r1 signer is provided, otherwise Empty
  const signerType =
    secpX !== 0n || secpY !== 0n
      ? BigInt(DeploymentSignerType.Secp256r1)
      : BigInt(DeploymentSignerType.Empty);

  const multisigThreshold = options.multisigThreshold; // 0 means no multisig
  const withdrawalLimit = options.withdrawalLimit;
  const feeRate = options.feeRate;
  const starkFeeRate = options.starkFeeRate;

  const [secpXLow, secpXHigh] = splitUint128(secpX);
  const [secpYLow, secpYHigh] = splitUint128(secpY);

  return [
    BigInt(BRAAVOS_ACCOUNT_CLASS_HASH), // 1 - account_implementation
    toFelt(signerType), // 2 - signer_type
    secpXLow, // 3 - secp256r1_signer.x_low (0 for Stark-only)
    secpXHigh, // 4 - secp256r1_signer.x_high (0 for Stark-only)
    secpYLow, // 5 - secp256r1_signer.y_low (0 for Stark-only)
    secpYHigh, // 6 - secp256r1_signer.y_high (0 for Stark-only)
    toFelt(multisigThreshold!), // 7 - multisig_threshold
    toFelt(withdrawalLimit!), // 8 - withdrawal_limit_low
    toFelt(feeRate!), // 9 - fee_rate
    toFelt(starkFeeRate!), // 10 - stark_fee_rate
    toFelt(config.chainId), // 11 - chain_id
    // signature (r, s) will be added after signing: 12, 13
  ];
}

export function signAuxParams(params: bigint[], privateKey: string) {
  // Normalize all params to felt strings
  const normalized = params.map((value) => toFelt(value).toString());
  const payloadHash = hash.computePoseidonHashOnElements(normalized);
  const signature = ec.starkCurve.sign(payloadHash, privateKey);
  return {
    r: BigInt(signature.r),
    s: BigInt(signature.s),
  };
}

export function buildFactoryCalldata(
  publicKey: string,
  deploymentParams: bigint[],
  signature: { r: bigint; s: bigint },
): string[] {
  const params = [
    ...deploymentParams.map((p) => p.toString()),
    signature.r.toString(),
    signature.s.toString(),
  ];

  return [publicKey, params.length.toString(), ...params];
}

export async function fundAccount(accountAddress: string) {
  const amount = config.fundAmount;
  console.log(`Funding ${accountAddress} with ${config.fundAmount}`);

  const amountUint256 = {
    low: BigInt(amount),
    high: 0n,
  };

  const { transaction_hash } = await deployer.execute([
    {
      contractAddress: STARKNET_TOKEN_ADDRESS,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: accountAddress,
        amount: amountUint256,
      }),
    },
  ]);

  console.log(`Transaction hash: ${transaction_hash}`);
  return transaction_hash;
}
