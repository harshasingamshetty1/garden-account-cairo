import { p256 } from "@noble/curves/nist.js";
import { randomBytes, createHash } from "crypto";
import { splitUint128 } from "./numeric";

/**
 * Secp256r1 public key structure matching Cairo's Secp256r1PubKey
 * Note: p256 is the same as secp256r1 (NIST P-256)
 */
export interface Secp256r1KeyPair {
  privateKey: Uint8Array;
  publicKey: {
    x: bigint;
    y: bigint;
  };
}

/**
 * Generate a mock secp256r1 keypair (imitating a hardware wallet)
 * @returns A keypair with private key and public key (x, y coordinates)
 */
export function generateSecp256r1KeyPair(): Secp256r1KeyPair {
  // Generate a random private key
  const privateKeyBytes = randomBytes(32);
  const privateKey = new Uint8Array(privateKeyBytes);

  // Get the public key point (uncompressed format: 0x04 + x(32) + y(32) = 65 bytes)
  // p256 is the same as secp256r1 (NIST P-256)
  const publicKey = p256.getPublicKey(privateKey, false); // false = uncompressed

  // Extract x and y coordinates (first 32 bytes = x, next 32 bytes = y)
  const xBytes = publicKey.slice(1, 33); // Skip the 0x04 prefix
  const yBytes = publicKey.slice(33, 65);

  // Convert to bigint
  const x = BigInt("0x" + Buffer.from(xBytes).toString("hex"));
  const y = BigInt("0x" + Buffer.from(yBytes).toString("hex"));

  return {
    privateKey,
    publicKey: { x, y },
  };
}

/**
 * Convert secp256r1 public key to Cairo calldata format
 * Returns [x_low, x_high, y_low, y_high] as bigint array
 */
export function secp256r1PubKeyToCalldata(keyPair: Secp256r1KeyPair): bigint[] {
  const [xLow, xHigh] = splitUint128(keyPair.publicKey.x);
  const [yLow, yHigh] = splitUint128(keyPair.publicKey.y);

  return [xLow, xHigh, yLow, yHigh];
}

/**
 * Convert secp256r1 public key to string array for calldata
 */
export function secp256r1PubKeyToStringArray(
  keyPair: Secp256r1KeyPair,
): string[] {
  const calldata = secp256r1PubKeyToCalldata(keyPair);
  return calldata.map((val) => val.toString());
}

/**
 * Create a secp256r1 keypair from a private key (hex string or Uint8Array)
 */
export function secp256r1KeyPairFromPrivateKey(
  privateKey: Uint8Array | string,
): Secp256r1KeyPair {
  // Convert private key to Uint8Array if it's a string
  let privKey: Uint8Array;
  if (typeof privateKey === "string") {
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    privKey = new Uint8Array(Buffer.from(hex, "hex"));
  } else {
    privKey = privateKey;
  }

  // Get the public key point
  const publicKey = p256.getPublicKey(privKey, false); // false = uncompressed

  // Extract x and y coordinates
  const xBytes = publicKey.slice(1, 33); // Skip the 0x04 prefix
  const yBytes = publicKey.slice(33, 65);

  // Convert to bigint
  const x = BigInt("0x" + Buffer.from(xBytes).toString("hex"));
  const y = BigInt("0x" + Buffer.from(yBytes).toString("hex"));

  return {
    privateKey: privKey,
    publicKey: { x, y },
  };
}

/**
 * Sign a transaction hash with secp256r1 (similar to signAuxParams but for secp256r1)
 * Uses SHAKE256 as the hash function (as per Braavos spec)
 * @param txHash - The transaction hash (bigint)
 * @param privateKey - The secp256r1 private key (Uint8Array or hex string)
 * @param publicKey - The secp256r1 public key (for inclusion in signature)
 * @returns Signature array: [SECP256R1_SIGNER_TYPE, x_low, x_high, y_low, y_high, r_low, r_high, s_low, s_high]
 */
export function signHashWithSecp256r1(
  txHash: bigint,
  privateKey: Uint8Array | string,
  publicKey: { x: bigint; y: bigint },
): string[] {
  const SECP256R1_SIGNER_TYPE = 2;

  // Convert private key to Uint8Array if it's a string
  let privKey: Uint8Array;
  if (typeof privateKey === "string") {
    const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    privKey = new Uint8Array(Buffer.from(hex, "hex"));
  } else {
    privKey = privateKey;
  }

  // Convert txHash to bytes (similar to Python: hash.to_bytes((hash.bit_length() + 7) // 8, byteorder="big"))
  const hashBitLength = txHash.toString(2).length;
  const hashByteLength = Math.ceil(hashBitLength / 8);
  const hashBytes = Buffer.alloc(hashByteLength);
  const hashHex = txHash.toString(16).padStart(hashByteLength * 2, "0");
  hashBytes.set(Buffer.from(hashHex, "hex"), 0);

  // Hash with SHAKE256 (variable length output, use length of hash_bytes)
  const shake256 = createHash("shake256", { outputLength: hashByteLength });
  shake256.update(hashBytes);
  const hashed = shake256.digest();

  // Sign with secp256r1 using ECDSA with SHAKE256
  // p256.sign returns compact signature (64 bytes: 32 bytes r + 32 bytes s)
  const signatureBytes = p256.sign(hashed, privKey);

  // Decode compact signature: first 32 bytes = r, next 32 bytes = s
  const rBytes = signatureBytes.slice(0, 32);
  const sBytes = signatureBytes.slice(32, 64);

  // Convert bytes to bigint
  const r = BigInt("0x" + Buffer.from(rBytes).toString("hex"));
  const s = BigInt("0x" + Buffer.from(sBytes).toString("hex"));

  // Convert to uint256 (split into low/high)
  const [xLow, xHigh] = splitUint128(publicKey.x);
  const [yLow, yHigh] = splitUint128(publicKey.y);
  const [rLow, rHigh] = splitUint128(r);
  const [sLow, sHigh] = splitUint128(s);

  // Format: [SECP256R1_SIGNER_TYPE, x_low, x_high, y_low, y_high, r_low, r_high, s_low, s_high]
  return [
    SECP256R1_SIGNER_TYPE.toString(),
    xLow.toString(),
    xHigh.toString(),
    yLow.toString(),
    yHigh.toString(),
    rLow.toString(),
    rHigh.toString(),
    sLow.toString(),
    sHigh.toString(),
  ];
}
