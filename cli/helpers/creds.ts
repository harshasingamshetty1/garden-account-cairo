import fs from "fs";
import { BASE_CLASS_HASH, config } from "../config";
import { hash, ec, stark } from "starknet";
import { BaseAccountInfo } from "../types";
import { readJsonFile, writeJsonFile } from "./file";

export function generateCreds() {
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = publicKey;
  const constructorCalldata = [publicKey];
  const address = hash.calculateContractAddressFromHash(
    salt,
    BASE_CLASS_HASH,
    constructorCalldata,
    0,
  );

  return {
    privateKey,
    publicKey,
    salt,
    constructorCalldata,
    address,
  };
}

export function readCreds(): BaseAccountInfo {
  const filePath = config.credsFile;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Base credentials not found at ${filePath}.`);
  }

  return readJsonFile<BaseAccountInfo>(filePath);
}

export function saveCreds(creds: BaseAccountInfo) {
  writeJsonFile(config.credsFile, {
    privateKey: creds.privateKey,
    publicKey: creds.publicKey,
    salt: creds.salt,
    address: creds.address,
    classHash: creds.classHash,
    constructorCalldata: creds.constructorCalldata,
  });
  console.log("Saved base credentials to", config.credsFile);
}
