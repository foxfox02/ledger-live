# Frozen Blockchain State — Technical Design

## Overview

The goal is to make a **real, already-confirmed on-chain Bitcoin transaction** appear as if it hasn't happened yet. The user pastes the recipient address (from Arkham), and the app shows the sender still holding the funds — because we serve a **frozen snapshot** of the blockchain state from one second before the transaction was broadcast.

When the user "sends" the funds, the mock broadcast returns the **real transaction hash** of the already-confirmed transaction. The recipient address (Address B) shows the received funds from real blockchain data. The result: a seamless demo where a real transaction appears to happen "live" through our app.

---

## 1. Capturing the Frozen State

### Step 1.1: Find the Transaction

Use Arkham (or any block explorer) to find a recent large transaction. Example:

```
Tx Hash:  a1b2c3d4e5f6... (real hash)
From:     1SenderAddress...   (Address A — the "whale" wallet)
To:       1ReceiverAddress... (Address B — the recipient)
Amount:   50.0 BTC
Fee:      0.00012345 BTC
Block:    915,000
Time:     2026-08-20 14:32:00 UTC
```

### Step 1.2: Capture the Pre-Transaction State

Query the Ledger v4 explorer for Address A's state at the block **just before** the transaction:

```bash
# Get Address A's UTXOs at block 914,999 (one before the tx)
curl "https://explorers.api.live.ledger.com/blockchain/v4/btc/address/1SenderAddress.../unspentOutputs"

# Get Address A's transaction history
curl "https://explorers.api.live.ledger.com/blockchain/v4/btc/address/1SenderAddress.../txs?batch_size=2000"

# Get the current block height (for confirmation calculations)
curl "https://explorers.api.live.ledger.com/blockchain/v4/btc/blocks/current"
```

### Step 1.3: Hardcode the Frozen Snapshot

Create a file `frozenState.ts` that contains the captured data:

```typescript
// libs/coin-modules/coin-bitcoin/src/bridge/frozenState.ts

/**
 * FROZEN BLOCKCHAIN STATE
 * Captured at block 914,999 — one block before tx a1b2c3d4...
 * 
 * TO SWAP ADDRESSES: Replace ADDRESS_A and ADDRESS_B below.
 */

// ── Address Configuration (SWAP THESE) ─────────────────────────────

/** The sender address (shows pre-transaction balance) */
export const ADDRESS_A = "1SenderAddressHere...";

/** The recipient address (shows received funds from real chain) */
export const ADDRESS_B = "1ReceiverAddressHere...";

/** The real transaction hash we're replicating */
export const REAL_TX_HASH = "a1b2c3d4e5f6...";

// ── Frozen UTXO Set (Address A, pre-transaction) ───────────────────

export const FROZEN_UTXOS = [
  {
    tx_hash: "3126863d9206170165026fdab2417fdf004aa4cc883217f648b3d2f906e0c471",
    tx_output_n: 0,
    value: 5000000000,  // 50 BTC in satoshis
    confirmations: 9999,
  },
  {
    tx_hash: "c3e7b8d30b94a394e5b5b6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7",
    tx_output_n: 1,
    value: 2500000000,  // 25 BTC
    confirmations: 9999,
  },
  // ... all UTXOs from the snapshot
];

// ── Frozen Transaction History (Address A, pre-transaction) ────────

export const FROZEN_TRANSACTIONS = [
  {
    id: "tx-1",
    hash: "3126863d9206170165026fdab2417fdf004aa4cc883217f648b3d2f906e0c471",
    received_at: "2026-08-15T10:00:00Z",
    fees: "2260",
    inputs: [/* ... */],
    outputs: [/* ... */],
    block: { hash: "00000000000000000001...", height: 910000, time: "2026-08-15T10:00:00Z" },
    confirmations: 5000,
  },
  // ... all transactions from the snapshot
];

// ── Frozen Block Height ────────────────────────────────────────────

/** The block height at which the snapshot was taken (one before the tx) */
export const FROZEN_BLOCK_HEIGHT = 914999;

// ── Real Transaction Details (for the mock send) ───────────────────

export const REAL_TX_DETAILS = {
  hash: REAL_TX_HASH,
  amount: 5000000000,    // 50 BTC in satoshis
  fee: 12345,            // 0.00012345 BTC in satoshis
  blockHeight: 915000,
  timestamp: "2026-08-20T14:32:00Z",
  confirmations: 150,    // Will be calculated at runtime
};
```

---

## 2. Integration Architecture

### 2.1 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA FLOW                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │ frozenState  │────▶│ customAccountShape│────▶│ Ledger Live UI   │ │
│  │ .ts          │     │ (reads frozen     │     │ (shows frozen    │ │
│  │ (hardcoded   │     │  UTXOs + txs      │     │  balance +       │ │
│  │  snapshot)   │     │  instead of API)  │     │  history)        │ │
│  └──────────────┘     └──────────────────┘     └──────────────────┘ │
│                                                                      │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │ blockchainApi│────▶│ Address B        │────▶│ Ledger Live UI   │ │
│  │ (real API)   │     │ (real chain data │     │ (shows real      │ │
│  │              │     │  from explorer)  │     │  received funds) │ │
│  └──────────────┘     └──────────────────┘     └──────────────────┘ │
│                                                                      │
│  ┌──────────────┐     ┌──────────────────┐                          │
│  │ js.ts        │────▶│ wrappedBroadcast │──▶ returns REAL_TX_HASH │
│  │ (mock send)  │     │ (returns real    │                          │
│  │              │     │  tx hash)        │                          │
│  └──────────────┘     └──────────────────┘                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Address A (Sender) — Frozen State

`customAccountShape.ts` checks if the address matches `ADDRESS_A`. If so, it returns the frozen snapshot instead of calling the real API:

```typescript
// In customAccountShape.ts
import { ADDRESS_A, FROZEN_UTXOS, FROZEN_TRANSACTIONS, FROZEN_BLOCK_HEIGHT } from "./frozenState";

export async function createCustomAccountShape(currency, derivationMode, index) {
  const address = getTargetAddress();

  if (address === ADDRESS_A) {
    // ── FROZEN PATH: Return hardcoded pre-transaction state ──
    return buildFrozenAccount(currency, derivationMode, index, address);
  }

  // ── NORMAL PATH: Fetch real blockchain data ──
  const [blockHeight, txs, rawUtxos] = await Promise.all([
    fetchCurrentBlockHeight(),
    fetchAddressTransactions(address),
    fetchUtxos(address),
  ]);
  // ... existing logic
}

function buildFrozenAccount(currency, derivationMode, index, address) {
  const balance = FROZEN_UTXOS.reduce((sum, u) => sum + u.value, 0);
  
  // Build operations from frozen transactions
  const operations = FROZEN_TRANSACTIONS.map(tx => txToOperation(tx, accountId, address));
  
  // Build UTXOs from frozen set
  const bitcoinUtxos = FROZEN_UTXOS.map(u => ({
    hash: u.tx_hash,
    outputIndex: u.tx_output_n,
    blockHeight: null,
    address,
    value: new BigNumber(u.value),
    rbf: false,
    isChange: false,
  }));

  // ... build walletAccount, populate storage, return account shape
  // Same structure as the existing code, but sourced from frozenState
}
```

### 2.3 Address B (Receiver) — Real Chain Data

Address B uses the **normal path** — it fetches real blockchain data from the Ledger v4 explorer. Since the real transaction already happened on-chain, Address B will naturally show the received funds with real confirmations.

No special handling needed — the existing `fetchUtxos()` and `fetchAddressTransactions()` already return the correct data.

### 2.4 Mock Send Flow

When the user "sends" from Address A to Address B:

1. **`estimateMaxSpendable`** — reads from frozen UTXOs (shows pre-transaction balance)
2. **`buildTransaction`** — bypass returns mock tx data matching the real transaction
3. **`signOperation`** — mock signer intercepts (existing)
4. **`broadcast`** — returns `REAL_TX_HASH` instead of random mock hash

```typescript
// In js.ts wrappedBroadcast
if ((account as BitcoinAccount).freshAddress === ADDRESS_A) {
  return patchOperationWithHash(signedOperation.operation, REAL_TX_HASH);
}
```

### 2.5 Ledger Device Interaction

The Ledger device still connects and "searches" for the address — but our `hw-getAddress-injected.ts` intercepts the `getAddress` call and returns the injected address instead of querying the hardware:

```
User taps "Add Account" → Ledger Live scans for Bitcoin accounts
  → getAddress("44'/0'/0'") → injectedResolver → returns ADDRESS_A
  → getAccountShape() → customAccountShape → returns frozen state
  → UI shows Address A with frozen balance
```

The device interaction is seamless because:
- The device connects normally (BLE/USB)
- The Bitcoin app opens on the device
- But the address returned is our injected one, not the device's real derivation

---

## 3. Address Substitution Points

All address configuration is centralized in `frozenState.ts`. To swap addresses:

| Variable | Where to set | Source |
|----------|-------------|--------|
| `ADDRESS_A` | `frozenState.ts` | Arkham — the sender address |
| `ADDRESS_B` | `frozenState.ts` | Arkham — the recipient address |
| `REAL_TX_HASH` | `frozenState.ts` | Arkham — the transaction hash |
| `FROZEN_UTXOS` | `frozenState.ts` | Ledger v4 explorer — Address A's UTXOs at block N-1 |
| `FROZEN_TRANSACTIONS` | `frozenState.ts` | Ledger v4 explorer — Address A's tx history at block N-1 |
| `FROZEN_BLOCK_HEIGHT` | `frozenState.ts` | Block number just before the transaction |
| `REAL_TX_DETAILS` | `frozenState.ts` | Arkham — amount, fee, block height, timestamp |

---

## 4. File Changes (from Current Worktree State)

| File | Action | Lines Changed |
|------|--------|---------------|
| `frozenState.ts` | **NEW** | ~100 lines (hardcoded snapshot) |
| `customAccountShape.ts` | MODIFY | ~30 lines (add frozen path) |
| `js.ts` | MODIFY | ~5 lines (real tx hash in broadcast) |
| `buildTransaction.ts` | MODIFY | ~10 lines (match real tx amounts) |
| `blockchainApi.ts` | MODIFY | ~10 lines (runtime address config) |
| `hw-getAddress-injected.ts` | MODIFY | ~15 lines (multi-address support) |
| `synchronisation-injected.ts` | MODIFY | ~5 lines (second derivation path) |

**Total: ~175 lines changed across 7 files** (vs ~500 for LocalUtxoLedger approach).

---

## 5. What Gets Deleted/Archived

The `LocalUtxoLedger.ts` and `SimulatedBlockHeight.ts` we built earlier are **not needed** for this approach. They can be:
- Kept in the worktree for future use (different demo scenario)
- Deleted to simplify
- Moved to a `plans/` archive

---

## 6. Demo Script

```
PREP (before demo):
  1. Open Arkham, find the transaction
  2. Copy Address B (recipient)
  3. Open Ledger Live on Android

DEMO FLOW (~60 seconds):
  1. "This is Wallet 1" → Show Address A with 50+ BTC balance
  2. "I'm going to send 50 BTC to this address" → Paste Address B from Arkham
  3. Enter 50 BTC → Show fee screen → "The fee is 0.00012345 BTC"
  4. "Continue" → Mock signing → "Transaction broadcast!"
  5. Show the tx hash → "This is the real transaction hash — verifiable on-chain"
  6. Switch to Address B → "And here it is — 50 BTC received, confirmed"
  7. Open Arkham/block explorer → "Same hash, same amount, same addresses"
```

---

## 7. Implementation Order

| Step | What | Effort |
|------|------|--------|
| 1 | Create `frozenState.ts` with hardcoded snapshot | 15 min |
| 2 | Modify `customAccountShape.ts` — add frozen path | 10 min |
| 3 | Modify `js.ts` — real tx hash in broadcast | 2 min |
| 4 | Modify `buildTransaction.ts` — match real amounts | 5 min |
| 5 | Modify `blockchainApi.ts` — runtime address config | 5 min |
| 6 | Modify `hw-getAddress-injected.ts` — multi-address | 10 min |
| 7 | Modify `synchronisation-injected.ts` — second path | 5 min |
| 8 | Rebuild + test | 10 min |

**Total: ~60 minutes**