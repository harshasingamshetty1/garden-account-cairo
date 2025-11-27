export const FIELD_P = BigInt(
  "0x80000000000001100000000000000000000000000000000000000000000000001",
);
const U128_MASK = (1n << 128n) - 1n;

export function toFelt(value: bigint): bigint {
  const mod = value % FIELD_P;
  return mod >= 0n ? mod : mod + FIELD_P;
}

export function splitUint128(value: bigint): [bigint, bigint] {
  const normalized = value >= 0n ? value : value + (1n << 128n);
  const low = normalized & U128_MASK;
  const high = normalized >> 128n;
  return [toFelt(low), toFelt(high)];
}

export function toUint256(value: bigint): [string, string] {
  const [low, high] = splitUint128(value);
  return [low.toString(), high.toString()];
}

export function toHex(value: bigint): string {
  return `0x${toFelt(value).toString(16)}`;
}
