import { config } from "./config";
import { RpcProvider, Account } from "starknet";

export * from "./helpers/numeric";
export * from "./helpers/deployment";
export * from "./helpers/file";
export * from "./helpers/creds";
export * from "./helpers/secp256r1";

export const provider = new RpcProvider({ nodeUrl: config.nodeUrl });
export const deployer = new Account({
  provider,
  address: config.deployerAddress,
  signer: config.deployerPrivateKey,
});
