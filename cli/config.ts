import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(configDir, "..");

export const config = {
  nodeUrl: "http://127.0.0.1:5050/rpc",
  chainId: BigInt("0x534e5f5345504f4c4941"), // sn sepolia shown in devnet idk chain
  artifactDir: path.join(projectRoot, "target", "dev"),
  sierraName: "braavos_account_BraavosAccount.contract_class.json",
  baseSierraName: "braavos_account_BraavosBaseAccount.contract_class.json",
  baseCasmName:
    "braavos_account_BraavosBaseAccount.compiled_contract_class.json",
  casmName: "braavos_account_BraavosAccount.compiled_contract_class.json",
  deployerAddress:
    "0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691",
  deployerPrivateKey:
    "0x0000000000000000000000000000000071d7bb07b9a64f6f78ac4c816aff4da9",
  factoryAddress:
    "0x03d94f65eBC7552Eb517DDb374250A9525b605f25F4E41ded6E7d7381Ff1c2e8",
  baseClassHash:
    "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564",
  udcAddress:
    "0x41A78E741E5AF2FEC34B695679BC6891742439F7AFB8484ECD7766661AD02BF",
  starknetTokenAddress:
    "0x4718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D",
  baseInfoFile: path.join(configDir, "base_deployed.json"),
  emptySignerType: 0,
  fundAmount: BigInt("1000000000000000000"),
};
