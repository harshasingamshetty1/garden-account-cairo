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

export type DeclareResult = {
  classHash: string;
  transactionHash: string;
};

export type DeploymentParamsOptions = {
  signerType?: DeploymentSignerType;
  multisigThreshold?: bigint;
  withdrawalLimit?: Uint128;
  feeRate?: Uint128;
  starkFeeRate?: Uint128;
  secpX?: Uint128;
  secpY?: Uint128;
};
