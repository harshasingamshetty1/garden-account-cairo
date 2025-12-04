import { TypedData } from "starknet";

export interface CreateGasSponsoredSessionTypedDataParams {
  accountAddress: string;
  caller: string;
  executeAfter: number;
  executeBefore: number;
  allowedMethods: Array<{ contractAddress: string; selector: string }>;
  spendingLimits: Array<{
    tokenAddress: string;
    amount: { low: string; high: string };
  }>;
  chainId: string;
}

export function createGasSponsoredSessionTypedData(
  params: CreateGasSponsoredSessionTypedDataParams,
): TypedData {
  const {
    caller,
    executeAfter,
    executeBefore,
    allowedMethods,
    spendingLimits,
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
      ],
      AllowedMethod: [
        { name: "Contract Address", type: "ContractAddress" },
        { name: "Selector", type: "selector" },
      ],
      TokenAmount: [
        { name: "token_address", type: "ContractAddress" },
        { name: "amount", type: "u256" },
      ],
      u256: [
        { name: "low", type: "u128" },
        { name: "high", type: "u128" },
      ],
    },
    primaryType: "GasSponsoredSessionExecution",
    domain: {
      name: "Account.execute_gs_session",
      version: "2",
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
    },
  };
}

export const MAX_UINT256 = {
  LOW: "0xffffffffffffffffffffffffffffffff",
  HIGH: "0xffffffffffffffffffffffffffffffff",
};
