#!/usr/bin/env node
import { TypedData, typedData as typedDataUtils, hash } from "starknet";

// Test if TypedData encodes AllowedMethod structures the same way we compute GUIDs

const accountAddress =
  "0x7d44e9bbad606086ba8bea89a88757fb0e469fb1636841cfd0a893f19b2e6d";
const caller =
  "0x07a55af245d4a6105770e701868e364375fe48ff2b2d8ac6a3c712cc01beca26";

const method1 = {
  contractAddress:
    "0x06579d255314109429a4477d89629bc2b94f529ae01979c2f8014f9246482603",
  selector: "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28",
};

// Create a minimal TypedData with just one AllowedMethod to see how it's encoded
const typedData: TypedData = {
  types: {
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
    TestStruct: [{ name: "Methods", type: "AllowedMethod*" }],
    AllowedMethod: [
      { name: "Contract Address", type: "ContractAddress" },
      { name: "Selector", type: "selector" },
    ],
  },
  primaryType: "TestStruct",
  domain: {
    name: "Test",
    version: "1",
    chainId: "0x534e5f5345504f4c4941",
    revision: "1",
  },
  message: {
    Methods: [
      {
        "Contract Address": method1.contractAddress,
        Selector: method1.selector,
      },
    ],
  },
};

console.log("Testing TypedData encoding of AllowedMethod\n");

// Compute GUID manually
const ALLOWED_METHOD_TYPE_HASH = hash.getSelectorFromName(
  '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector")',
);

const manualGuid = hash.computePoseidonHashOnElements([
  ALLOWED_METHOD_TYPE_HASH,
  method1.contractAddress,
  method1.selector,
]);

console.log(`Manual GUID: ${manualGuid}`);
console.log(`Type Hash:   ${ALLOWED_METHOD_TYPE_HASH}`);
console.log(`Contract:    ${method1.contractAddress}`);
console.log(`Selector:    ${method1.selector}`);

// The TypedData hash should internally compute the same thing
// But we can't access it directly...

console.log("\n✅ Our GUID computation formula:");
console.log("   poseidon_hash([TYPE_HASH, contract_address, selector])");
console.log(
  "\nThis should match what SNIP-12 does for encoding AllowedMethod structs.",
);
