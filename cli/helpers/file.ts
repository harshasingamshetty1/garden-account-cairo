import fs from "fs";
import path from "path";
import { AddSignerInfo, Secp256r1KeyPair, SignerInfo } from "../types";

const ASCII_ENCODING: BufferEncoding = "ascii";
const JSON_SPACES = 2;

export function readJsonFile<T>(location: string): T {
  const rawData = fs.readFileSync(location, { encoding: ASCII_ENCODING });
  return JSON.parse(rawData);
}

export function writeJsonFile(location: string, payload: unknown) {
  // Ensure directory exists
  const dir = path.dirname(location);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(location, JSON.stringify(payload, null, JSON_SPACES), {
    encoding: ASCII_ENCODING,
  });
}

export function loadSignerStorage(filePath: string): AddSignerInfo {
  try {
    return readJsonFile<AddSignerInfo>(filePath);
  } catch {
    return {
      signers: [],
      addedAt: new Date().toISOString(),
    };
  }
}

export function saveSignerInfo(
  filePath: string,
  storage: AddSignerInfo,
  keyPair: Secp256r1KeyPair,
  txHash: string,
) {
  const privateKeyHex = "0x" + Buffer.from(keyPair.privateKey).toString("hex");

  const signerInfo: SignerInfo = {
    privateKey: privateKeyHex,
    publicKeyX: keyPair.publicKey.x.toString(),
    publicKeyY: keyPair.publicKey.y.toString(),
  };

  storage.signers.push(signerInfo);
  storage.transactionHash = txHash;
  storage.addedAt = new Date().toISOString();

  writeJsonFile(filePath, storage);
}

/**
 * Parse comma-separated addresses or single address
 */
export function parseAddresses(addressesStr: string): string[] {
  const trimmed = addressesStr.trim();

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((addr) => {
        const cleaned = addr.trim();
        if (!cleaned.startsWith("0x")) {
          return "0x" + cleaned;
        }
        return cleaned;
      })
      .filter((addr) => addr.length > 0);
  }

  const addr = trimmed;
  if (!addr.startsWith("0x")) {
    return ["0x" + addr];
  }
  return [addr];
}
