import path from "node:path";
import dotenv from "dotenv";
import fs from "fs";

const configDir = path.join(process.cwd(), "cli");
const dataDir = path.join(configDir, "data");
dotenv.config({ path: path.join(configDir, ".env") });

const configJsonPath = path.join(configDir, "config.json");
let configJson: {
  whitelistAddress: string;
  whitelistTokenAddresses: string[];
  permissionAddress: string;
  htlcAddress: string;
  htlcTokenAddress: string;
  deployment: {
    fundAmount: string;
    feeRate: string;
    starkFeeRate: string;
    withdrawalLimit: string;
    multisigThreshold: string;
    addSignerMultisigThreshold: string;
  };
  session: {
    executeAfterOffset: number;
    executeBeforeDuration: number;
  };
};

try {
  const configData = fs.readFileSync(configJsonPath, "utf-8");
  configJson = JSON.parse(configData);
} catch (error) {
  throw new Error(
    `❌ Failed to load config.json from ${configJsonPath}\n` +
      `   Make sure the file exists and is valid JSON.\n` +
      `   Error: ${error instanceof Error ? error.message : error}`,
  );
}

export const config = {
  nodeUrl: requireEnv("STARKNET_NODE_URL"),
  chainId: requireEnv("CHAIN_ID"),
  deployerAddress: requireEnv("DEPLOYER_ADDRESS"),
  deployerPrivateKey: requireEnv("DEPLOYER_PRIVATE_KEY"),

  // File paths
  credsFile: path.join(dataDir, "deployed.json"),
  signerFile: path.join(dataDir, "signer.json"),
  sessionFile: path.join(dataDir, "session.json"),

  // From config.json
  whitelistAddress: configJson.whitelistAddress,
  whitelistTokenAddresses: configJson.whitelistTokenAddresses,
  permissionAddress: configJson.permissionAddress,
  htlcAddress: configJson.htlcAddress,
  htlcTokenAddress: configJson.htlcTokenAddress,

  // Deployment configuration
  deployment: {
    fundAmount: BigInt(configJson.deployment.fundAmount),
    feeRate: BigInt(configJson.deployment.feeRate),
    starkFeeRate: BigInt(configJson.deployment.starkFeeRate),
    withdrawalLimit: BigInt(configJson.deployment.withdrawalLimit),
    multisigThreshold: BigInt(configJson.deployment.multisigThreshold),
    addSignerMultisigThreshold: BigInt(
      configJson.deployment.addSignerMultisigThreshold,
    ),
  },

  // Session configuration
  session: {
    executeAfterOffset: configJson.session.executeAfterOffset,
    executeBeforeDuration: configJson.session.executeBeforeDuration,
  },
};

// Braavos and Starknet Constants
export const FACTORY_ADDRESS =
  "0x03d94f65eBC7552Eb517DDb374250A9525b605f25F4E41ded6E7d7381Ff1c2e8";

export const STARKNET_TOKEN_ADDRESS =
  "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D";

export const BASE_CLASS_HASH =
  "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";

export const BASE_INFO_FILE = path.join(dataDir, "deployed.json");

export const BRAAVOS_ACCOUNT_CLASS_HASH =
  "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";

export const HTLC_ADDRESS = config.htlcAddress;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${name}\n` +
        `   Please set it in ${path.join(configDir, ".env")} or environment.\n` +
        `   Example: ${name}=your_value_here`,
    );
  }
  return value;
}
