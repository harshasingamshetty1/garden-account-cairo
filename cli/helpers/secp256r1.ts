import { ec } from "elliptic";
import { splitUint128 } from "./numeric";
import { Secp256r1KeyPair } from "../types";

const CURVE = new ec("p256");

export function generateSecp256r1KeyPair(): Secp256r1KeyPair {
  const keyPair = CURVE.genKeyPair();

  const privateKeyBuffer = Buffer.from(keyPair.getPrivate("hex"), "hex");
  const privateKey = new Uint8Array(privateKeyBuffer);

  const pubPoint = keyPair.getPublic();
  const x = BigInt("0x" + pubPoint.getX().toString("hex"));
  const y = BigInt("0x" + pubPoint.getY().toString("hex"));

  return {
    privateKey,
    publicKey: { x, y },
  };
}

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

export function secp256r1PubKeyToStringArray(
  keyPair: Secp256r1KeyPair,
): string[] {
  const calldata = secp256r1PubKeyToCalldata(keyPair);
  return calldata.map((val) => val.toString());
}

export function secp256r1KeyPairFromPrivateKey(
  privateKey: Uint8Array | string,
): Secp256r1KeyPair {
  let privKeyHex: string;
  if (typeof privateKey === "string") {
    privKeyHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  } else {
    privKeyHex = Buffer.from(privateKey).toString("hex");
  }

  const keyPair = CURVE.keyFromPrivate(privKeyHex, "hex");
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
