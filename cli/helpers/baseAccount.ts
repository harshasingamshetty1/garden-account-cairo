import fs from "fs";

import { config } from "../config";
import { hash, ec, stark } from "starknet";
import { BaseAccountInfo } from "../types";
import { readJsonFile, writeJsonFile } from "./file";
import { toHex } from "./numeric";

export function readBaseCredentials(): BaseAccountInfo {
  const filePath = config.baseInfoFile;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Base credentials not found at ${filePath}.`);
  }

  return readJsonFile<BaseAccountInfo>(filePath);
}

export function saveBaseCredentials(creds: BaseAccountInfo) {
  writeJsonFile(config.baseInfoFile, {
    privateKey: creds.privateKey,
    publicKey: creds.publicKey,
    salt: creds.salt,
    address: creds.address,
    classHash: creds.classHash,
    constructorCalldata: creds.constructorCalldata,
  });
  console.log("Saved base credentials to", config.baseInfoFile);
}

export function generateCredentials(baseClassHash?: string) {
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = stark.randomAddress();
  const constructorCalldata = [publicKey];
  const address = hash.calculateContractAddressFromHash(
    salt,
    baseClassHash || config.baseClassHash,
    constructorCalldata,
    config.udcAddress,
  );
  return {
    privateKey,
    publicKey,
    salt,
    constructorCalldata,
    address,
  };
}

export function buildUdcCalldata(
  baseClassHash: string,
  salt: string,
  publicKey: string,
) {
  return [baseClassHash, salt, "0x3", "0x1", publicKey];
}

export function buildFactoryCalldata(
  publicKey: string,
  supplementalParams: bigint[],
) {
  const hexEncoded = supplementalParams.map((value) => toHex(value));
  return [publicKey, supplementalParams.length.toString(), ...hexEncoded];
}
