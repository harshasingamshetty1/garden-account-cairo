import { readCreds, provider, getBravosAccount } from "../utils";
import { buildApprovalCall } from "../helpers/calls";
import { config, HTLC_ADDRESS } from "../config/constants";
import { Provider } from "starknet";

export async function approveHTLCTokens() {
  try {
    const creds = readCreds();
    const account = getBravosAccount(creds);
    const call = buildApprovalCall(config.htlcTokenAddress, HTLC_ADDRESS);
    const response = await account.execute(call);

    await provider.waitForTransaction(response.transaction_hash, {
      retryInterval: 5000,
    });

    await verifyAllowance(
      provider,
      creds.address,
      HTLC_ADDRESS,
      config.htlcTokenAddress,
    );
    console.log(`✅ Approved HTLC token`);
  } catch (error) {
    console.error(
      "❌ Approval failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

async function verifyAllowance(
  provider: Provider,
  ownerAddress: string,
  spenderAddress: string,
  tokenAddress: string,
): Promise<void> {
  try {
    const result = await provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: "allowance",
      calldata: [ownerAddress, spenderAddress],
    });

    const allowanceResult = Array.isArray(result) ? result : [result];
    const allowance = allowanceResult[0]?.toString() || "0";

    if (allowance === "0") {
      console.warn("   ⚠️  Warning: Allowance is 0");
    }
  } catch (error) {
    console.error(
      "   ❌ Error verifying allowance:",
      error instanceof Error ? error.message : error,
    );
  }
}

// if (require.main === module) {
//   approveHTLCTokens();
// }
