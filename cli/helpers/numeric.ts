import { TypedData, typedData as typedDataUtils } from "starknet";

export const U128_MASK = (BigInt(1) << BigInt(128)) - BigInt(1);

export function splitUint128(value: bigint): [bigint, bigint] {
  const low = value & U128_MASK;
  const high = value >> BigInt(128);
  return [low, high];
}

export function toFelt(value: bigint | number | string): bigint {
  const felt = BigInt(value);
  const PRIME =
    BigInt(2) ** BigInt(251) +
    BigInt(17) * BigInt(2) ** BigInt(192) +
    BigInt(1);
  return felt % PRIME;
}

export function toUint256(value: bigint): [string, string] {
  const [low, high] = splitUint128(value);
  return [low.toString(), high.toString()];
}

export function toHex(value: bigint): string {
  return `0x${toFelt(value).toString(16)}`;
}

export function calculateSessionHash(
  typedDataObj: TypedData,
  accountAddress: string,
): string {
  const msgHash = typedDataUtils.getMessageHash(typedDataObj, accountAddress);
  return msgHash;
}
