# Full Send Flow Port Plan

## What the working Desktop APK does differently

The Desktop `js-injected.ts` uses `createMockSignerContext()` (from
`signer-injected.ts`) at bridge-creation time. This wraps the **real**
hardware SignerContext with a mock that, when `deviceId === MOCK_DEVICE_ID`,
returns a completely mocked `BitcoinSigner` — no hardware interaction at all.

Critically, `createMockSignerContext` intercepts at the **caller site** —
the bridge's `signOperation`, `buildSignOperation`, `getAddress`, etc. all
route through this wrapped context. The wallet-btc Xpub is NOT involved
because the mock signer stubs out every method that would normally call
into the Xpub chain.

## What we need to change in our js.ts

1. Import `createMockSignerContext` from a new
   `libs/coin-modules/coin-bitcoin/src/signer-injected.ts` file that we
   write (ported from Desktop `signer-injected.ts`).

2. In `createBridges()`, wrap the real `signerContext` with
   `createMockSignerContext(signerContext)` before passing it to
   `buildCurrencyBridge` and `buildAccountBridge`.

3. Define `MOCK_DEVICE_ID` as a constant (e.g., `"mock"`).

4. The `getTransactionStatus` / `computeFees` / `getWalletAccount` chain
   is called from `buildAccountBridge`'s `getTransactionStatus` method
   (line 154 of the real `js.ts`). These functions take the `account`
   object — which already has our `walletAccount` with the real Xpub.
   The mock signer context **does not** change this path.

The key insight: the mock signer helps with signing (`signOperation`),
NOT with `getTransactionStatus`. The validation/estimation chain
(recipient entry → getTransactionStatus → computeFees) happens via the
account object, not the signer.

## Simplified plan — just finish the Xpub mock

Since the mock signer only helps with the signing step (after amount/summary),
and the recipient-entry error is in `getTransactionStatus`, the pragmatic
fix is to **complete the Xpub mock** by implementing every method that
`getTransactionStatus` calls on the account's `walletAccount.xpub.explorer`.

From the real `getTransactionStatus.ts`:
- `computeFees` → calls `getWalletAccount(account).xpub.explorer.???`
  → likely `getFees` (already mocked), `getCurrentBlock` (already mocked),
  and possibly others.

Let me trace the exact `computeFees` call chain to see which exact Xpub
methods are called during recipient entry validation, then add stubs for
those specific methods.