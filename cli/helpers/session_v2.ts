import { TypedData } from "starknet";

export interface CalldataValidation {
  offset: number;
  value: string;
  validation_type: number; // 0 = Eq
}

export interface CreateGasSponsoredSessionTypedDataV2Params {
  accountAddress: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{ contractAddress: string; selector: string }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  calldataValidations: CalldataValidation[][]; // One array per method
  chainId: string;
}

export function createGasSponsoredSessionTypedDataV2(
  params: CreateGasSponsoredSessionTypedDataV2Params,
): TypedData {
  const {
    caller,
    executeAfter,
    executeBefore,
    allowedMethods,
    spendingLimits,
    calldataValidations,
    chainId,
  } = params;

  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      GasSponsoredSessionExecution: [
        { name: "Caller", type: "ContractAddress" },
        { name: "Execute After", type: "timestamp" },
        { name: "Execute Before", type: "timestamp" },
        { name: "Allowed Methods", type: "AllowedMethod*" },
        { name: "Spending Limits", type: "TokenAmount*" },
        { name: "Calldata Validations", type: "CalldataValidation**" },
      ],
      AllowedMethod: [
        { name: "Contract Address", type: "ContractAddress" },
        { name: "Selector", type: "selector" },
      ],
      TokenAmount: [
        { name: "token_address", type: "ContractAddress" },
        { name: "amount", type: "u256" },
      ],
      CalldataValidation: [
        { name: "Offset", type: "u128" },
        { name: "Value", type: "felt" },
        { name: "Validation Type", type: "u128" },
      ],
      u256: [
        { name: "low", type: "u128" },
        { name: "high", type: "u128" },
      ],
    },
    primaryType: "GasSponsoredSessionExecution",
    domain: {
      name: "Account.execute_gs_session",
      version: "3", // V2 uses version 3
      chainId: chainId,
      revision: "1",
    },
    message: {
      Caller: caller,
      "Execute After": executeAfter.toString(),
      "Execute Before": executeBefore.toString(),
      "Allowed Methods": allowedMethods.map((method) => ({
        "Contract Address": method.contractAddress,
        Selector: method.selector,
      })),
      "Spending Limits": spendingLimits.map((limit) => ({
        token_address: limit.tokenAddress,
        amount: {
          low: limit.amount.low,
          high: limit.amount.high,
        },
      })),
      "Calldata Validations": calldataValidations.map((validations) =>
        validations.map((validation) => ({
          Offset: validation.offset.toString(),
          Value: validation.value,
          "Validation Type": validation.validation_type.toString(),
        })),
      ),
    },
  };
}

export const MAX_UINT256 = {
  LOW: "0xffffffffffffffffffffffffffffffff",
  HIGH: "0xffffffffffffffffffffffffffffffff",
};

export enum CalldataValidationType {
  Eq = 0, // Equals
}
