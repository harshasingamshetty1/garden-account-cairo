import { Call, CallData } from "starknet";
import { MAX_UINT256 } from "./session";
import { DeploymentSignerType, Secp256r1KeyPair } from "../types";
import { formatPublicKey } from "./secp256r1";

export function buildFactoryCalldata(
  publicKey: string,
  deploymentParams: bigint[],
  signature: { r: bigint; s: bigint },
): string[] {
  const params = [
    ...deploymentParams.map((p) => p.toString()),
    signature.r.toString(),
    signature.s.toString(),
  ];

  return [publicKey, params.length.toString(), ...params];
}

export function buildApprovalCall(
  tokenAddress: string,
  spenderAddress: string,
): Call {
  return {
    contractAddress: tokenAddress,
    entrypoint: "approve",
    calldata: [spenderAddress, MAX_UINT256.LOW, MAX_UINT256.HIGH],
  };
}

export function buildAddSignerCall(
  accountAddress: string,
  keyPair: Secp256r1KeyPair,
  multisigThreshold: bigint,
): Call {
  const formattedPubKey = formatPublicKey(keyPair.publicKey);

  return {
    contractAddress: accountAddress,
    entrypoint: "add_secp256r1_signer",
    calldata: CallData.compile({
      secp256r1_signer: formattedPubKey,
      signer_type: DeploymentSignerType.Secp256r1,
      multisig_threshold: Number(multisigThreshold),
    }),
  };
}
