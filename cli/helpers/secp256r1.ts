import { ec } from "elliptic";
import { createHash } from "crypto";
import { splitUint128 } from "./numeric";
import { Secp256r1KeyPair } from "../types";

const curve = new ec("p256");

export function generateSecp256r1KeyPair(): Secp256r1KeyPair {
  // Generate a random key pair using elliptic
  const keyPair = curve.genKeyPair();

  // Get private key as Buffer
  const privateKeyBuffer = Buffer.from(keyPair.getPrivate("hex"), "hex");
  const privateKey = new Uint8Array(privateKeyBuffer);

  // Get public key point
  const pubPoint = keyPair.getPublic();
  const x = BigInt("0x" + pubPoint.getX().toString("hex"));
  const y = BigInt("0x" + pubPoint.getY().toString("hex"));

  return {
    privateKey,
    publicKey: { x, y },
  };
}

/**
 * Convert secp256r1 public key to Cairo calldata format
 */
export function secp256r1PubKeyToCalldata(keyPair: Secp256r1KeyPair): bigint[] {
  const [xLow, xHigh] = splitUint128(keyPair.publicKey.x);
  const [yLow, yHigh] = splitUint128(keyPair.publicKey.y);
  return [xLow, xHigh, yLow, yHigh];
}

export function formatPublicKey(publicKey: { x: bigint; y: bigint }) {
  const [xLow, xHigh] = splitUint128(publicKey.x);
  const [yLow, yHigh] = splitUint128(publicKey.y);

  return {
    pub_x: { low: xLow, high: xHigh },
    pub_y: { low: yLow, high: yHigh },
  };
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
  // Convert private key to hex string
  let privKeyHex: string;
  if (typeof privateKey === "string") {
    privKeyHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  } else {
    privKeyHex = Buffer.from(privateKey).toString("hex");
  }

  // Create key pair from private key
  const keyPair = curve.keyFromPrivate(privKeyHex, "hex");

  // Get public key point
  const pubPoint = keyPair.getPublic();
  const x = BigInt("0x" + pubPoint.getX().toString("hex"));
  const y = BigInt("0x" + pubPoint.getY().toString("hex"));

  // Convert private key to Uint8Array
  const privKeyBuffer = Buffer.from(privKeyHex, "hex");

  return {
    privateKey: new Uint8Array(privKeyBuffer),
    publicKey: { x, y },
  };
}
