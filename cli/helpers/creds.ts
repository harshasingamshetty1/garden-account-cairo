import { BASE_CLASS_HASH } from "../config";
import { hash, ec, stark, CallData } from "starknet";
import { DeploymentSignerType, Secp256r1KeyPair } from "../types";
import { formatPublicKey } from "./secp256r1";

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

export function buildAddSignerCall(
  accountAddress: string,
  keyPair: Secp256r1KeyPair,
) {
  const formattedPubKey = formatPublicKey(keyPair.publicKey);

  return {
    contractAddress: accountAddress,
    entrypoint: "add_secp256r1_signer",
    calldata: CallData.compile({
      secp256r1_signer: formattedPubKey,
      signer_type: DeploymentSignerType.Secp256r1,
      multisig_threshold: 0, // No multisig - any signer can sign independently
    }),
  };
}
