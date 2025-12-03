# HTLC Session Management

This directory contains scripts for setting up and executing session-based permissions for HTLC (Hashed Timelock Contract) operations using Braavos accounts.

## Overview

The session system allows you to grant temporary, limited permissions to another address (the "session owner") to execute specific functions on your behalf without giving them full control of your account. This is particularly useful for HTLC operations where you want to authorize a solver or automated system to perform actions like `initiate`, `redeem`, and `refund`.

## Prerequisites

1. A deployed Braavos account (use `npm run deploy`)
2. Approved tokens to the HTLC contract (use `npm run approve`)
3. Environment variables configured in `cli/.env`

## Scripts

### 1. `execute.ts` - Setup Session Permissions

This script creates a gas-sponsored session that grants permission to a specific address to call HTLC functions.

#### Usage

```bash
SESSION_OWNER=0x<authorized_address> npm run setup-session
```

Or with custom HTLC and token addresses:

```bash
SESSION_OWNER=0x<authorized_address> \
HTLC_ADDRESS=0x<htlc_contract> \
TOKEN_ADDRESS=0x<token_address> \
npm run setup-session
```

#### What it does

1. Reads your deployed Braavos account credentials from `cli/deployed.json`
2. Creates a session with:
   - **Caller**: The address that will be authorized to execute transactions
   - **Allowed Methods**: `initiate`, `redeem`, and `refund` on the HTLC contract
   - **Time Bounds**: Valid for 24 hours by default
   - **Spending Limits**: Unlimited token spending (configurable)
3. Signs the session request with your Braavos account's private key
4. Saves the session information to `cli/session.json`

#### Output

The script creates `cli/session.json` containing:
- Session hash
- Caller address
- Time bounds
- Allowed methods
- Spending limits
- Signature
- HTLC and Braavos account addresses

### 2. `session-execute.ts` - Execute HTLC Operations

This script allows the session owner to execute HTLC operations using the authorized session.

#### Usage

The session owner needs:
1. The `cli/session.json` file
2. Their private key as `CALLER_PRIVATE_KEY`

**Initiate an HTLC:**
```bash
CALLER_PRIVATE_KEY=0x<caller_private_key> \
npm run session-execute initiate <recipient> <amount> <hashlock> <timelock>
```

**Redeem an HTLC:**
```bash
CALLER_PRIVATE_KEY=0x<caller_private_key> \
npm run session-execute redeem <htlc_id> <preimage>
```

**Refund an HTLC:**
```bash
CALLER_PRIVATE_KEY=0x<caller_private_key> \
npm run session-execute refund <htlc_id>
```

#### Parameters

Adjust these based on your HTLC contract's interface:

- **initiate**:
  - `recipient`: Address to receive the locked funds
  - `amount`: Amount of tokens to lock (as u128 low part)
  - `hashlock`: Hash of the secret preimage
  - `timelock`: Unix timestamp when the HTLC expires

- **redeem**:
  - `htlc_id`: ID of the HTLC to redeem
  - `preimage`: Secret that hashes to the hashlock

- **refund**:
  - `htlc_id`: ID of the HTLC to refund (after timelock expires)

## Complete Workflow Example

### Step 1: Deploy Braavos Account

```bash
npm run deploy
```

This creates `cli/deployed.json` with your account credentials.

### Step 2: Approve Tokens to HTLC

```bash
npm run approve
```

This approves the HTLC contract to spend tokens from your Braavos account.

### Step 3: Setup Session for Solver

```bash
SESSION_OWNER=0x1234567890abcdef... npm run setup-session
```

This creates `cli/session.json` authorizing the solver address.

### Step 4: Share Session Info with Solver

Send the `cli/session.json` file to the solver. They will use this to execute operations.

### Step 5: Solver Executes HTLC Operations

The solver can now execute operations:

```bash
# Initiate an HTLC
CALLER_PRIVATE_KEY=0xsolver_key npm run session-execute initiate \
  0xrecipient_address \
  1000000000000000000 \
  0xhashlock \
  1735689600

# Later, redeem the HTLC
CALLER_PRIVATE_KEY=0xsolver_key npm run session-execute redeem \
  123 \
  0xpreimage
```

## Session Features

### Gas-Sponsored Sessions

The sessions use the gas-sponsored model where:
- The **caller** (session owner) pays for gas fees
- The **Braavos account** authorizes which operations can be performed
- No need to transfer funds or keys to the caller

### Security Features

1. **Time-bounded**: Sessions have explicit start and end times
2. **Method restrictions**: Only specific functions can be called
3. **Spending limits**: Optional limits on token spending
4. **Revocable**: Sessions can be revoked by the Braavos account owner
5. **Signature verification**: All operations require the original session signature

### Revoking a Session

To revoke an active session:

```typescript
import { getBravosAccount, readCreds } from "./utils";
import { hash } from "starknet";

const creds = readCreds();
const account = getBravosAccount(creds);

const sessionHash = "0x..."; // From session.json

await account.execute({
  contractAddress: creds.address,
  entrypoint: "revoke_session",
  calldata: [sessionHash],
});
```

## Configuration

### Environment Variables

Create a `cli/.env` file with:

```env
STARKNET_NODE_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_7
CHAIN_ID=0x534e5f5345504f4c4941  # SN_SEPOLIA
DEPLOYER_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...
FUND_AMOUNT=100000000000000000  # 0.1 ETH
```

### Customizing Session Parameters

Edit `cli/execute.ts` to customize:

- **Session duration**: Change `executeBefore` calculation
- **Spending limits**: Modify the `spendingLimits` array
- **Allowed methods**: Add or remove methods from `allowedMethods`

Example for 48-hour session:

```typescript
const executeBefore = now + 48 * 60 * 60; // 48 hours
```

Example for specific spending limit:

```typescript
const spendingLimits = [
  {
    tokenAddress: TOKEN_ADDRESS,
    amount: {
      low: "100000000000000000000", // 100 tokens
      high: "0",
    },
  },
];
```

## Troubleshooting

### Session expired

If you get a "Session has expired" error:
1. Check the current time vs `executeBefore` in `session.json`
2. Create a new session with `npm run setup-session`

### Invalid signature

If you get an "INVALID_SIG" error:
1. Ensure the `CALLER_PRIVATE_KEY` matches the `caller` address in `session.json`
2. Verify the session was created with the correct Braavos account

### Method not allowed

If you get a "BAD_CALL" error:
1. Ensure the method is in the `allowedMethods` list
2. Check that the HTLC contract address matches

### Spending limit exceeded

If you get a "BAD_SPENDING" error:
1. Check the spending limits in `session.json`
2. Create a new session with higher limits

## Advanced Usage

### Multiple Sessions

You can create multiple sessions with different permissions:

```bash
# Session for solver A (all operations)
SESSION_OWNER=0xsolverA npm run setup-session

# Save as session-solverA.json
mv cli/session.json cli/session-solverA.json

# Session for solver B (only redeem and refund)
# Edit execute.ts to remove 'initiate' from allowedMethods
SESSION_OWNER=0xsolverB npm run setup-session
mv cli/session.json cli/session-solverB.json
```

### Monitoring Sessions

Check if a session is validated:

```bash
# Using starknet CLI or custom script
starknet call \
  --address <braavos_account> \
  --abi <abi_file> \
  --function is_session_validated \
  --inputs <session_hash>
```

### Session Limits Tracking

Check spending limits:

```bash
starknet call \
  --address <braavos_account> \
  --abi <abi_file> \
  --function get_spending_limit_amount_spent \
  --inputs <session_hash> <token_address>
```

## Architecture

### Session Flow

```
┌─────────────────┐
│  Braavos Owner  │
└────────┬────────┘
         │ 1. Create & Sign Session
         ▼
┌─────────────────┐
│  Session Info   │
│  + Signature    │
└────────┬────────┘
         │ 2. Share
         ▼
┌─────────────────┐
│  Session Owner  │
│   (Solver)      │
└────────┬────────┘
         │ 3. Execute with Session
         ▼
┌─────────────────┐
│ Braavos Account │
│  ┌──────────┐   │
│  │ Validate │   │
│  │ Session  │   │
│  └────┬─────┘   │
│       │         │
│  ┌────▼─────┐   │
│  │ Execute  │   │
│  │ HTLC Ops │   │
│  └──────────┘   │
└─────────────────┘
```

### Gas Costs

- **Session creation**: ~100-200k gas (one-time)
- **First execution**: ~300-400k gas (validation + execution)
- **Subsequent executions**: ~150-250k gas (cached validation)

## References

- [Braavos Account Documentation](https://braavos.app/developers)
- [Starknet Sessions SNIP](https://github.com/starknet-io/SNIPs)
- [HTLC Contract Standard](https://en.bitcoin.it/wiki/Hash_Time_Locked_Contracts)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the Braavos account logs
3. Verify all environment variables are set correctly
4. Ensure you're using the correct network (testnet/mainnet)

