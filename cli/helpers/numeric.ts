import { TypedData, typedData as typedDataUtils } from "starknet";

export const U128_MASK = (1n << 128n) - 1n;

export function splitUint128(value: bigint): [bigint, bigint] {
  const low = value & U128_MASK;
  const high = value >> 128n;
  return [low, high];
}

export function toFelt(value: bigint | number | string): bigint {
  const felt = BigInt(value);
  const PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
  return felt % PRIME;
}

export function toUint256(value: bigint): [string, string] {
  const [low, high] = splitUint128(value);
  return [low.toString(), high.toString()];
}

export function toHex(value: bigint): string {
  return `0x${toFelt(value).toString(16)}`;
}

/**
 * Calculate the session hash from typed data
 */
export function calculateSessionHash(
  typedDataObj: TypedData,
  accountAddress: string,
): string {
  const msgHash = typedDataUtils.getMessageHash(typedDataObj, accountAddress);
  return msgHash;
}
