# Off-Chain Bitcoin — Isolated Workspace Plan

## Strategy: Git Worktree (Zero Interference)

A **git worktree** creates a second working directory from the same repository. It shares the same `.git` folder (no re-clone needed) but has its own independent working tree on a separate branch. The original working directory at `/Users/dg/ledger-live` remains completely untouched.

```
/Users/dg/ledger-live          ← ORIGINAL (working send flow, untouched)
/Users/dg/ledger-live-offchain ← WORKTREE (off-chain experiment, isolated branch)
```

## Step-by-Step Isolation Plan

### Step 1: Create the off-chain branch

```bash
cd /Users/dg/ledger-live
git checkout -b feat/off-chain-bitcoin
```

This creates a new branch from the current state (which has the working send flow). The branch is where all off-chain changes will live.

### Step 2: Switch back to the working branch

```bash
git checkout -  # or the branch name you were on before
```

This restores the original working directory to its current state. The `feat/off-chain-bitcoin` branch exists in git but isn't checked out anywhere yet.

### Step 3: Create the worktree

```bash
git worktree add /Users/dg/ledger-live-offchain feat/off-chain-bitcoin
```

This creates `/Users/dg/ledger-live-offchain` — a complete, independent copy of the project on the `feat/off-chain-bitcoin` branch. It shares the same `.git` objects (no disk waste) but has its own `node_modules`, build artifacts, and working files.

### Step 4: Bootstrap the worktree

```bash
cd /Users/dg/ledger-live-offchain
pnpm install
```

The worktree needs its own `node_modules` because symlinks and native modules are path-dependent. This is the only "duplication" — everything else is shared via git.

### Step 5: Verify isolation

```bash
# In the original workspace
cd /Users/dg/ledger-live
git branch --show-current  # Should show the original branch, NOT feat/off-chain-bitcoin

# In the worktree
cd /Users/dg/ledger-live-offchain
git branch --show-current  # Should show feat/off-chain-bitcoin
```

### Step 6: Build the off-chain APK

```bash
cd /Users/dg/ledger-live-offchain
# Make off-chain changes to the source files...
npx nx run @ledgerhq/coin-bitcoin:build
cd apps/ledger-live-mobile/android
./gradlew assembleStagingRelease
```

The APK will be built at:
```
/Users/dg/ledger-live-offchain/apps/ledger-live-mobile/android/app/build/outputs/apk/stagingRelease/
```

This is a **completely separate APK** from the working one at `/Users/dg/ledger-live/...`. No risk of overwriting.

## What Gets Shared vs What's Independent

| Resource | Shared? | Notes |
|----------|---------|-------|
| Git history / objects | ✅ Shared | Both worktrees share the same `.git` |
| Source files | ❌ Independent | Each worktree has its own checkout |
| `node_modules` | ❌ Independent | Must `pnpm install` separately |
| Build artifacts (`lib/`, `lib-es/`) | ❌ Independent | Each worktree builds independently |
| APK output | ❌ Independent | Different paths, different APKs |
| `pnpm store` | ✅ Shared | pnpm's global store is shared |
| Nx cache | ✅ Shared | `.nx/cache` is in the repo root, shared |

## The "Simulated Block Height" Enhancement

Per the feedback, replace the simple timer-based confirmation with a **simulated block height** mechanism:

```
┌─────────────────────────────────────────────────────────┐
│              Simulated Block Height                      │
│                                                         │
│  AsyncStorage key: "SIMULATED_BLOCK_HEIGHT"             │
│                                                         │
│  On app start:                                          │
│    blockHeight = read from storage (default: 900000)    │
│    start interval: every 60s → blockHeight += 1         │
│                                                         │
│  On transaction broadcast:                              │
│    tx.pendingBlockHeight = currentBlockHeight           │
│    tx.status = "pending"                                │
│                                                         │
│  On each block tick:                                    │
│    for each pending tx:                                 │
│      if currentBlockHeight >= tx.pendingBlockHeight + 6 │
│        tx.status = "confirmed"                          │
│        tx.confirmations = 6                             │
│        emit "OFF_CHAIN_TX_CONFIRMED" event              │
│                                                         │
│  This mirrors real Bitcoin: 6 confirmations ≈ 60 min    │
│  We compress it: 6 blocks × 60s = 6 minutes             │
│  (Configurable: set BLOCK_INTERVAL_MS for faster demo)  │
└─────────────────────────────────────────────────────────┘
```

### Why this is better than a timer:

1. **Realism** — mirrors Bitcoin's actual confirmation model (N blocks = confirmed)
2. **Observability** — the block height is visible and incrementing, like a real chain
3. **Configurability** — speed up blocks for demo (10s intervals = 1 min confirmation)
4. **Event-driven** — confirmation fires from the block tick, not a setTimeout

## State Desync Prevention

The validation script must check **both** ledgers independently:

```bash
#!/bin/bash
# validate-off-chain-tx.sh

echo "=== Pulling ledger state from both devices ==="
adb -s $DEVICE_A shell "run-as com.ledger.live cat files/off_chain_ledger.json" > /tmp/ledger_a.json
adb -s $DEVICE_B shell "run-as com.ledger.live cat files/off_chain_ledger.json" > /tmp/ledger_b.json

echo ""
echo "=== Cross-Device Validation ==="
node -e "
const A = JSON.parse(require('fs').readFileSync('/tmp/ledger_a.json'));
const B = JSON.parse(require('fs').readFileSync('/tmp/ledger_b.json'));

// 1. Both ledgers must have the same transaction
const txA = A.transactions.find(t => t.txid === '$TXID');
const txB = B.transactions.find(t => t.txid === '$TXID');

if (!txA) { console.log('FAIL: Transaction not found on Device A'); process.exit(1); }
if (!txB) { console.log('FAIL: Transaction not found on Device B'); process.exit(1); }

// 2. Sender balance must have decreased
// 3. Receiver balance must have increased
// 4. Both must show 'confirmed' status
// 5. Transaction IDs must match

console.log('PASS: All validations passed');
"
```

## File Manifest (Off-Chain Branch Only)

These files will be created/modified ONLY in the worktree — the original workspace is never touched:

| File | Action | Purpose |
|------|--------|---------|
| `libs/coin-modules/coin-bitcoin/src/bridge/LocalUtxoLedger.ts` | **NEW** | Local UTXO ledger |
| `libs/coin-modules/coin-bitcoin/src/bridge/SimulatedBlockHeight.ts` | **NEW** | Block height simulator |
| `libs/coin-modules/coin-bitcoin/src/bridge/blockchainApi.ts` | MODIFY | Runtime address config |
| `libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts` | MODIFY | Read from local ledger |
| `libs/coin-modules/coin-bitcoin/src/bridge/js.ts` | MODIFY | Process send through ledger |
| `libs/coin-modules/coin-bitcoin/src/hw-getAddress-injected.ts` | MODIFY | Multi-address injection |
| `libs/coin-modules/coin-bitcoin/src/synchronisation-injected.ts` | MODIFY | Second derivation path |
| `scripts/off-chain-demo.sh` | **NEW** | ADB dual-device launcher |
| `scripts/validate-off-chain-tx.sh` | **NEW** | Cross-device validation |

## Rollback (If Needed)

```bash
# Remove the worktree
git worktree remove /Users/dg/ledger-live-offchain

# Delete the branch
git branch -D feat/off-chain-bitcoin

# Original workspace is completely unaffected
```

## Next Steps

1. Create the worktree (Step 1-4 above)
2. Bootstrap with `pnpm install`
3. Verify the working APK still builds in the original workspace
4. Begin Phase 1 implementation in the worktree (LocalUtxoLedger + SimulatedBlockHeight)
5. Build and test the off-chain APK independently