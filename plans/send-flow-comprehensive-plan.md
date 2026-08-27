# Send Flow — Comprehensive Plan

## Current Architecture (our codebase)

```
apps/ledger-live-mobile/src/families/bitcoin/setup.ts
  → import { createBridges } from "@ledgerhq/coin-bitcoin/bridge/js"
  → creates SignerContext (real hardware)
  → calls createBridges(signerContext, coinConfig)
    → buildCurrencyBridge(signerContext)  // scanAccounts
    → buildAccountBridge(signerContext)   // sync, send, signOperation

libs/coin-modules/coin-bitcoin/src/bridge/js.ts  ← OUR FILE
  → createBridges(signerContext, coinConfig)
  → wraps signerContext with mockSigner (OUR ADDITION — line 118-148)
  → buildCurrencyBridge(wrappedSignerContext)
  → buildAccountBridge(wrappedSignerContext)
```

## Where the error occurs

When user taps "Send" → enters recipient:
1. `getTransactionStatus(account, transaction)` fires
2. `computeFees(account, transaction, errors, ...)` is called
3. `calculateFees({ account, transaction })` (LRU cached)
4. `getFeesForTransaction({ account, transaction })` 
5. `buildTransaction(account, transaction)` ← **THE CRASH SITE**
6. `getWalletAccount(account)` — succeeds (our mock walletAccount)
7. `wallet.estimateAccountMaxSpendable(walletAccount, ...)` ← **CALLS xpub.prototypes**
8. xpub calls internal methods that expect real explorer/storage/crypto

### Why our mock signer doesn't help here

The mock signer context (lines 118-148 in js.ts) wraps the `SignerContext` interface.
`SignerContext` is used by:
- `buildSignOperation(signerContext)` → signing step only (step 8+ of send flow)
- `buildCurrencyBridge(signerContext)` → `scanAccounts`
- `buildAccountBridge(signerContext)` → `sync`

But `getTransactionStatus` → `computeFees` → `buildTransaction` does NOT use
a `SignerContext`. It directly calls `getWalletAccount(account).xpub.*`.
These are methods on the walletAccount object we set in `customAccountShape.ts`.

## Why the Desktop working APK succeeds

The Desktop `js-injected.ts` is structurally IDENTICAL to our `js.ts` —
same `buildCurrencyBridge` and `buildAccountBridge` using the same
`getTransactionStatus`, `computeFees`, `buildTransaction` chain.

The **ONLY difference** is the **complete Xpub mock** — our Xpub
constructed via `new Xpub({...})` must be missing prototype methods
that the Desktop version provides through its `createMockBitcoinSigner`
and `createMockSignerContext` in `signer-injected.ts`.

## Root cause identified

The `new Xpub(...)` call in `createCustomAccountShape` creates a real
Xpub class instance. BUT:

1. The Xpub constructor stores `opts.storage`, `opts.explorer`, `opts.crypto`
   as `this.storage`, `this.explorer`, `this.crypto`.

2. Xpub.prototype methods (like `estimateAccountMaxSpendable`) access
   `this.explorer`, `this.storage`, `this.crypto` — these should work
   because our mocks are complete.

3. BUT the `estimateAccountMaxSpendable` method is NOT on Xpub — it's on
   the `wallet` module (`@ledgerhq/wallet-btc/wallet`). The wallet module's
   `estimateAccountMaxSpendable` takes our walletAccount and calls:
   ```
   walletAccount.xpub.explorer.someMethod()
   walletAccount.xpub.storage.someMethod()
   walletAccount.xpub.crypto.someMethod()
   ```

4. Our `explorerMock` and `storageMock` are complete (all methods stubbed)
   — the error must be in a method call we haven't identified yet.

## The missing method

The only way to find it is to capture the FULL stack trace with the
exact method name. Our logcat only shows "TypeError: undefined is not a
function" without naming which method.

## Implementation plan (option A — targeted fix)

1. Add `console.error` logging around the `buildTransaction` call in `getFeesForTransaction.ts`
2. Add `try/catch` in `buildTransaction` that logs the full error
3. Rebuild, reproduce the error, read the exact method name
4. Add that one method stub to our explorerMock/storageMock/cryptoMock
5. Rebuild, retest

## Implementation plan (option B — comprehensive fix)

Instead of chasing individual missing methods, construct a truly
complete Xpub mock by importing the wallet-btc `wallet` module
and providing mock implementations of `estimateAccountMaxSpendable`
and `buildAccountTx` at the wallet level, BEFORE the xpub chain
is engaged.

### Files to modify:
1. `libs/coin-modules/coin-bitcoin/src/bridge/customAccountShape.ts`
   → Replace `walletAccount.xpub` with a fully wrapped Xpub that has
     all prototype methods implemented, not just constructor stubs

2. OR: `libs/coin-modules/coin-bitcoin/src/buildTransaction.ts`
   → Add early return for injected accounts that returns mock fees/inputs/outputs
   → This bypasses the entire xpub chain for the injected address

### Recommended: Option B

Option B is more reliable because it cuts the entire xpub chain at
the entry point rather than trying to satisfy each method call one
at a time. The pattern would be:

```typescript
// In buildTransaction.ts, add early check:
if (account.freshAddress === TARGET_BITCOIN_ADDRESS) {
  return {
    fee: 50000,  // mock fee in sats
    inputs: [],
    outputs: [],
  };
}
// ... rest of real buildTransaction
```

This bypasses the ENTIRE wallet-btc/xpub chain for the injected
account, just like the Desktop working APK does.