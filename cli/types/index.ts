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

export interface DeploymentParamsOptions {
  multisigThreshold?: bigint;
  withdrawalLimit?: bigint;
  feeRate?: bigint;
  starkFeeRate?: bigint;
  secpX?: bigint;
  secpY?: bigint;
  signerType?: DeploymentSignerType;
}
