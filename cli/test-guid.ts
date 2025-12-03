#!/usr/bin/env node
import { hash } from "starknet";

// Test how starknet.js hashes empty arrays
console.log("Testing hash computations:\n");

// Empty array hash
const emptyHash = hash.computePoseidonHashOnElements([]);
console.log(`Empty array hash: ${emptyHash}`);

// V2 ALLOWED_METHOD_TYPE_HASH
const ALLOWED_METHOD_TYPE_HASH_V2 = hash.getSelectorFromName(
  '"AllowedMethod"("Contract Address":"ContractAddress","Selector":"selector","Calldata Validations":"CalldataValidation*")"CalldataValidation"("Offset":"u128","Value":"felt","Validation Type":"u128")',
);

console.log(`\nALLOWED_METHOD_TYPE_HASH_V2: ${ALLOWED_METHOD_TYPE_HASH_V2}`);

// Test method
const contract =
  "0x06579d255314109429a4477d89629bc2b94f529ae01979c2f8014f9246482603";
const selector =
  "0x2aed25fcd0101fcece997d93f9d0643dfa3fbd4118cae16bf7d6cd533577c28";

// GUID calculation
const guid = hash.computePoseidonHashOnElements([
  ALLOWED_METHOD_TYPE_HASH_V2,
  contract,
  selector,
  emptyHash,
]);

console.log(`\nMethod 1 (initiate):`);
console.log(`  Contract: ${contract}`);
console.log(`  Selector: ${selector}`);
console.log(`  GUID: ${guid}`);

// Compare with what we're passing
console.log(
  `\n Expected GUID from calldata: 0x62d837be1ea76d43de05ccf262ecfc792ef67dbcd471aa94e31120cea0e713d`,
);
console.log(
  `Match: ${guid === "0x62d837be1ea76d43de05ccf262ecfc792ef67dbcd471aa94e31120cea0e713d"}`,
);
