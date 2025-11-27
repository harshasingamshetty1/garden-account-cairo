import { config } from "../config";
import { hash, ec } from "starknet";
import { DeploymentParamsOptions } from "../types";
import { splitUint128, toFelt, toUint256 } from "./numeric";
import { deployer } from "../utils";

export function buildDeploymentParams(
  options: DeploymentParamsOptions = {},
  classHash: string,
): bigint[] {
  const signerType = BigInt(
    options.signerType !== undefined
      ? options.signerType
      : config.emptySignerType,
  );
  const multisigThreshold = options.multisigThreshold ?? 0n;
  const withdrawalLimit = options.withdrawalLimit ?? 0n;
  const feeRate = options.feeRate ?? 0n;
  const starkFeeRate = options.starkFeeRate ?? 0n;
  const secpX = options.secpX ?? 0n;
  const secpY = options.secpY ?? 0n;

  const [withdrawalLow, withdrawalHigh] = splitUint128(withdrawalLimit);
  const [feeLow, feeHigh] = splitUint128(feeRate);
  const [starkFeeLow, starkFeeHigh] = splitUint128(starkFeeRate);

  const [secpXLow, secpXHigh] = splitUint128(secpX);
  const [secpYLow, secpYHigh] = splitUint128(secpY);

  return [
    BigInt(classHash),
    toFelt(signerType),
    secpXLow,
    secpXHigh,
    secpYLow,
    secpYHigh,
    toFelt(multisigThreshold),
    withdrawalLow,
    withdrawalHigh,
    feeLow,
    feeHigh,
    starkFeeLow,
    starkFeeHigh,
    toFelt(config.chainId),
  ];
}

export function signAuxParams(params: bigint[], privateKey: string) {
  const normalized = params.map((value) => toFelt(value).toString());
  const payloadHash = hash.computePoseidonHashOnElements(normalized);
  const signature = ec.starkCurve.sign(payloadHash, privateKey);
  return {
    r: BigInt(signature.r),
    s: BigInt(signature.s),
  };
}

export const DEFAULT_RESOURCE_BOUNDS = {
  l2_gas: { max_amount: 20000000n, max_price_per_unit: 1000000000n },
  l1_gas: { max_amount: 20000000n, max_price_per_unit: 1000000000n },
  l1_data_gas: { max_amount: 20000000n, max_price_per_unit: 1000000000n },
};

export async function fundAccount(accountAddress: string) {
  const [low, high] = toUint256(config.fundAmount);
  console.log(`Funding ${accountAddress} with ${config.fundAmount}`);
  const { transaction_hash } = await deployer.execute(
    {
      contractAddress: config.starknetTokenAddress,
      entrypoint: "transfer",
      calldata: [accountAddress, low, high],
    },
    {
      skipValidate: true,
      resourceBounds: DEFAULT_RESOURCE_BOUNDS,
    },
  );
  return transaction_hash;
}

export function buildAccountAddress(
  baseClassHash: string,
  starkPubKey: string,
) {
  return hash.calculateContractAddressFromHash(
    starkPubKey,
    baseClassHash,
    [starkPubKey],
    "0x0",
  );
}
