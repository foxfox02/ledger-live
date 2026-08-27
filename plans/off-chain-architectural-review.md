# Off-Chain Worktree — Architectural Review

## Current State of the Worktree

The worktree at `/Users/dg/ledger-live-offchain` on branch `feat/off-chain-bitcoin` has a **mixed state** — some files are the modified injection versions, others are stock.

### Files that ARE the modified injection versions (copied from original workspace):

| File | Status | Notes |
|------|--------|-------|
| `blockchainApi.ts` | ✅ Modified | Has `getTargetAddress()`, `setTargetAddress()`, `fetchUtxos()`, etc. |
| `customAccountShape.ts` | ✅ Modified | Has `createXpubFromKeyData()`, `wallet.generateAccount()`, UTXO storage population |
| `hw-getAddress-injected.ts` | ✅ Modified | Has `registerInjectionPath()`, `shouldInjectAddress()`, returns injected address |
| `signer-injected.ts` | ✅ Modified | Has `createMockSignerContext()`, `wrapSignerWithMockSigning()`, `MOCK_DEVICE_ID` |
| `synchronisation-injected.ts` | ✅ Modified | Has `makeInjectedGetAccountShape()`, wallet account preservation |

### Files that are STOCK (NOT modified — need porting):

| File | Status | What's missing |
|------|--------|---------------|
| **`js.ts`** | ❌ STOCK | Imports `resolver from "../hw-getAddress"` (real), uses `makeGetAccountShape` (not injected), NO mock signer context, NO mock broadcast, NO `createMockSignerContext` wiring |
| **`setup.ts`** | ❌ STOCK | Imports `bitcoinResolver` (real device), resolver uses real hardware |
| **`buildTransaction.ts`** | ❌ STOCK | No bypass for injected address, no `script` field on mock outputs |
| **`estimateMaxSpendable.ts`** | ❌ STOCK | No debug logging (minor) |
| **`hw/getAddress/index.ts`** | ❌ STOCK | No debug logging (minor) |

## What the Working Original Has That the Worktree Doesn't

### 1. `js.ts` — Bridge Wiring (CRITICAL)

The working original's `js.ts` has these modifications that the worktree's stock version lacks:

```typescript
// Working original imports:
import { patchOperationWithHash } from "@ledgerhq/ledger-wallet-framework/operation";
import { getTargetAddress } from "./blockchainApi";
import { createMockSignerContext, registerMockSignAddress } from "../signer-injected";
import injectedResolver from "../hw-getAddress-injected";
import { makeInjectedGetAccountShape } from "../synchronisation-injected";

// Working original buildCurrencyBridge:
function buildCurrencyBridge(signerContext: SignerContext) {
  const getAddress = injectedResolver(signerContext);  // ← injected, not real
  const scanAccounts = makeScanAccounts<BitcoinAccount>({
    getAccountShape: makeInjectedGetAccountShape(signerContext) as any,  // ← injected
    getAddressFn: getAddressWrapper(getAddress),
    postSync,
  });
  // ...
}

// Working original wrappedBroadcast:
const wrappedBroadcast = async ({ account, signedOperation, broadcastConfig }) => {
  calculateFees.reset();
  if ((account as BitcoinAccount).freshAddress === getTargetAddress()) {
    const mockHash = "mock_txid_" + Date.now().toString(16) + "_" + Math.random().toString(16).slice(2, 10);
    return patchOperationWithHash(signedOperation.operation, mockHash);
  }
  return broadcast({ account, signedOperation, ...(broadcastConfig ? { broadcastConfig } : {}) });
};

// Working original createBridges:
export function createBridges(signerContext: SignerContext, coinConfig: CoinConfig) {
  setCoinConfig(coinConfig);
  registerMockSignAddress(getTargetAddress());
  const wrappedSignerContext = createMockSignerContext(signerContext);
  const cb = buildCurrencyBridge(wrappedSignerContext);
  const ab = buildAccountBridge(wrappedSignerContext);
  return { currencyBridge: cb, accountBridge: ab };
}
```

### 2. `setup.ts` — Device-Action Resolver (CRITICAL)

The working original uses `injectedResolver` for the device-action resolver:

```typescript
// Working original:
import injectedResolver from "@ledgerhq/coin-bitcoin/hw-getAddress-injected";

const resolver: Resolver = (transport, addressOpt) => {
  const signerContext: SignerContext = (_, crypto, fn) => fn(createSigner(transport, crypto));
  return injectedResolver(signerContext)("", addressOpt);  // ← injected
};
```

The worktree's stock version uses `bitcoinResolver` (real device).

### 3. `buildTransaction.ts` — Transaction Bypass (CRITICAL)

The working original has a bypass for the injected address that returns mock tx data with proper `script` (Buffer) and `value` (BigNumber) fields. The worktree's stock version goes through the real wallet-btc transaction builder.

## Architecture for Off-Chain Dual-Device Send/Receive

### Layer Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     OFF-CHAIN ARCHITECTURE                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────┐          ┌─────────────────┐                │
│  │   Device 1 APK   │          │   Device 2 APK   │                │
│  │  (Sender)        │          │  (Receiver)      │                │
│  │                  │          │                  │                │
│  │  Address: ADDR_A │  send    │  Address: ADDR_B │                │
│  │  Balance: X BTC  │─────────▶│  Balance: Y BTC  │                │
│  │                  │          │                  │                │
│  │  ┌─────────────┐ │          │  ┌─────────────┐ │                │
│  │  │LocalUtxo    │ │          │  │LocalUtxo    │ │                │
│  │  │Ledger       │ │          │  │Ledger       │ │                │
│  │  │(AsyncStorage)│ │          │  │(AsyncStorage)│ │                │
│  │  └─────────────┘ │          │  └─────────────┘ │                │
│  └─────────────────┘          └─────────────────┘                │
│           │                           │                           │
│           └───────────┬───────────────┘                           │
│                       │                                           │
│              ┌────────▼────────┐                                  │
│              │  Shared Ledger   │  ← Optional: for two-device     │
│              │  (Embedded HTTP  │     sync. For single-device,    │
│              │   Server or file)│     both addresses share one    │
│              └─────────────────┘     AsyncStorage instance.       │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow: Send from Device 1 to Device 2

```
1. User on Device 1 enters recipient (ADDR_B) + amount
2. estimateMaxSpendable → reads from LocalUtxoLedger (ADDR_A's UTXOs)
3. buildTransaction → bypass returns mock tx (same as working version)
4. signOperation → mock signer intercepts (same as working version)
5. broadcast → wrappedBroadcast intercepts:
   a. Calls LocalUtxoLedger.processSend(ADDR_A, ADDR_B, amount, fee)
   b. Marks ADDR_A's UTXOs as spent
   c. Creates new UTXOs for ADDR_B (amount) and ADDR_A (change)
   d. Creates transaction records for both addresses
   e. Persists to AsyncStorage
   f. Returns mock tx hash
6. Device 1 re-syncs → balance decreases
7. Device 2 re-syncs → balance increases
```

### Key Design Decisions

**1. Single AsyncStorage for single-device demo**

Both addresses share the same `LocalUtxoLedger` instance in AsyncStorage. When Device 1 "sends" to Device 2, the ledger is updated and both accounts reflect the change on next sync. This is the simplest approach and works for a single-device demo.

**2. Runtime address configuration**

`blockchainApi.ts` already has `setTargetAddress()`. We extend this to read from AsyncStorage at startup, so the ADB script can configure different addresses per device without rebuilding.

**3. Dual derivation paths**

`synchronisation-injected.ts` registers both `44'/0'/0'` (account 0 = sender) and `44'/0'/1'` (account 1 = receiver). `shouldUseCustomAccountShape` is extended to match `index === 0 || index === 1`.

**4. Simulated block height for confirmation**

Instead of a simple timer, a `SimulatedBlockHeight` class increments a counter in AsyncStorage every N seconds. Transactions get a `pendingBlockHeight` on broadcast. When `currentBlockHeight >= pendingBlockHeight + 6`, the transaction flips to "confirmed."

### Files to Create/Modify in the Worktree

| File | Action | Purpose |
|------|--------|---------|
| `libs/coin-modules/coin-bitcoin/src/bridge/LocalUtxoLedger.ts` | **NEW** | Local UTXO ledger with CRUD + persistence |
| `libs/coin-modules/coin-bitcoin/src/bridge/SimulatedBlockHeight.ts` | **NEW** | Block height simulator |
| `libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts` | MODIFY | Add `loadTargetAddress()` from AsyncStorage |
| `libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts` | MODIFY | Read from LocalUtxoLedger instead of explorer API |
| `libs/coin-modules/coin-bitcoin/src/bridge/js.ts` | **PORT** | Port ALL modifications from working original |
| `libs/coin-modules/coin-bitcoin/src/hw-getAddress-injected.ts` | MODIFY | Multi-address support (map path → address) |
| `libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts` | MODIFY | Register second derivation path, extend `shouldUseCustomAccountShape` |
| `libs/coin-modules/coin-bitcoin/src/buildTransaction.ts` | **PORT** | Port bypass from working original |
| `libs/ledger-live-common/src/families/bitcoin/setup.ts` | **PORT** | Port `injectedResolver` from working original |
| `scripts/off-chain-demo.sh` | **NEW** | ADB dual-device launcher |

### Implementation Order

1. **Port `js.ts`** — wire the injection into the bridge (same as working original)
2. **Port `setup.ts`** — wire `injectedResolver` for device-action (same as working original)
3. **Port `buildTransaction.ts`** — add the bypass with proper mock fields
4. **Create `LocalUtxoLedger.ts`** — the core off-chain data structure
5. **Create `SimulatedBlockHeight.ts`** — block-based confirmation
6. **Modify `customAccountShape.ts`** — read from local ledger
7. **Modify `blockchainApi.ts`** — runtime address config
8. **Modify `hw-getAddress-injected.ts`** — multi-address support
9. **Modify `synchronisation-injected.ts`** — second derivation path
10. **Create `scripts/off-chain-demo.sh`** — ADB automation

### Regression Safety

All modifications are additive — they extend existing behavior without removing it:
- `js.ts`: The mock signer context wraps the real one; non-injected addresses still use real hardware
- `setup.ts`: The injected resolver only fires for registered paths; all other paths use real device
- `customAccountShape.ts`: The local ledger path only activates for injected addresses; real accounts still use explorer API
- `synchronisation-injected.ts`: Additional derivation paths are registered alongside existing ones

The working single-address send flow (what's installed on your device now) will continue to function identically after these changes, because the off-chain logic only activates when a second address is registered and the local ledger is initialized.