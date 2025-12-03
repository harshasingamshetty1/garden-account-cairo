#!/usr/bin/env node
import crypto from "crypto";

// Generate a random secret
const secret = crypto.randomBytes(32).toString("hex");
console.log("\n🔑 Secret (KEEP THIS SAFE!):");
console.log(`   ${secret}`);

// Generate SHA-256 hash
const hash = crypto.createHash("sha256").update(secret).digest();
console.log("\n📝 SHA-256 Hash (hex):");
console.log(`   0x${hash.toString("hex")}`);

// Convert to array of 8 u32 values
const u32Array: number[] = [];
for (let i = 0; i < 8; i++) {
  const value = hash.readUInt32BE(i * 4);
  u32Array.push(value);
}

console.log("\n📋 Cairo format [u32; 8]:");
console.log("[");
u32Array.forEach((val, idx) => {
  console.log(`0x${val.toString(16).padStart(8, "0")},`);
});
console.log("]");

console.log(
  "\n⚠️  IMPORTANT: Save the secret! You'll need it to redeem the HTLC.",
);
console.log(
  `\nTo redeem, use: npm run session-execute redeem <htlc_id> 0x${secret}`,
);
