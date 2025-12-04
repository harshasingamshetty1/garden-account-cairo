export type Uint128 = bigint;

export enum DeploymentSignerType {
  Empty = 0,
  Stark = 1,
  Secp256r1 = 2,
  Deprecated = 3,
  Moa = 4,
  Webauthn = 5,
}

export type BaseAccountInfo = {
  privateKey: string;
  publicKey: string;
  salt: string;
  constructorCalldata: string[];
  address: string;
  classHash?: string;
};

export type DeploymentParamsOptions = {
  multisigThreshold?: bigint;
  withdrawalLimit?: bigint;
  feeRate?: bigint;
  starkFeeRate?: bigint;
  secpX?: bigint;
  secpY?: bigint;
};

export type SignerInfo = {
  privateKey: string;
  publicKeyX: string;
  publicKeyY: string;
};

export type AddSignerInfo = {
  signers: SignerInfo[];
  transactionHash?: string;
  addedAt: string;
};

export type Secp256r1KeyPair = {
  privateKey: Uint8Array;
  publicKey: {
    x: bigint;
    y: bigint;
  };
};

export type SessionInfo = {
  sessionHash: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{
    contractAddress: string;
    selector: string;
  }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  signature: string[];
  htlcAddress: string;
  braavosAccount: string;
  createdAt: string;
};
