import path from "node:path";
import dotenv from "dotenv";

const configDir = path.join(process.cwd(), "cli");
dotenv.config({ path: path.join(configDir, ".env") });

export const config = {
  nodeUrl: requireEnv("STARKNET_NODE_URL"),
  chainId: requireEnv("CHAIN_ID"),

  deployerAddress: requireEnv("DEPLOYER_ADDRESS"),
  deployerPrivateKey: requireEnv("DEPLOYER_PRIVATE_KEY"),

  credsFile: path.join(configDir, "deployed.json"),
  signerFile: path.join(configDir, "signer.json"),
  sessionFile: path.join(configDir, "session.json"),

  fundAmount: BigInt(requireEnv("FUND_AMOUNT")),
};

export const FACTORY_ADDRESS =
  "0x03d94f65eBC7552Eb517DDb374250A9525b605f25F4E41ded6E7d7381Ff1c2e8";
export const STARKNET_TOKEN_ADDRESS =
  "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D";
// 0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5
export const BASE_CLASS_HASH =
  "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";
export const BASE_INFO_FILE = path.join(configDir, "deployed.json");
export const BRAAVOS_ACCOUNT_CLASS_HASH =
  "0x03957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";
export const HTLC_ADDRESS =
  "0x06579d255314109429a4477d89629bc2b94f529ae01979c2f8014f9246482603";
export const TOKEN_ADDRESS =
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5";

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
