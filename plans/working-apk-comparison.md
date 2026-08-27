# Working APK vs Our Build — Complete Comparison

## `synchronisation-injected.ts`

| Aspect | Working APK | Our Build | Impact |
|--------|------------|-----------|--------|
| Return type | `async (info, config)` — always Promise | Synchronous function (correct for our framework's Observable) | Framework version difference |
| Sync case | **Preserves wallet account + storage state** (lines 69-89) | Spreads fresh `customAccountShape` only (lines 81-87) | 🔴 **Critical** — wallet account lost on sync |
| Wallet account preservation | `preservedWalletAccount.xpub.storage = newWalletAccount.xpub.storage` | Not done | 🔴 Storage state lost |
| bitcoinResources | `{ ...customAccountShape.bitcoinResources, walletAccount: preservedWalletAccount }` | Spread from `customAccountShape` (fresh wallet account) | 🔴 Fresh wallet account each sync |

## `customAccountShape.ts`

| Aspect | Working APK | Our Build | Impact |
|--------|------------|-----------|--------|
| `wallet.generateAccount` 2nd arg | `currency` (CryptoCurrency directly — older API) | `toWalletBtcCurrency(currency)` (newer API) | API version difference |
| `getAccountAddresses` override | ✅ Overridden | ❌ Not overridden | 🟡 May affect address lookup |
| `persistentStateManager` | ✅ Used for state persistence | ❌ Not used | 🟡 State lost on app restart |
| `createNetworkInfo` | ✅ Real fee data from API | ❌ Not implemented | 🟡 Fee estimation may differ |
| `seedIdentifier` | ✅ Set to `TARGET_BITCOIN_ADDRESS` | ✅ Set to `address` | ✅ Same |
| `xpub` field | ✅ Set to `validXpub` | ✅ Set to `validXpub` | ✅ Same |

## `signer-injected.ts`

| Aspect | Working APK | Our Build | Impact |
|--------|------------|-----------|--------|
| `wrapSignerWithMockSigning` intercepts `splitTransaction` | ❌ No (only `createPaymentTransaction`) | ✅ Yes (both methods) | Our version is MORE complete |
| `wrapSignerWithMockSigning` intercepts `createPaymentTransaction` | ✅ Yes | ✅ Yes | Same |
| `MOCK_DEVICE_ID` gate | ✅ Yes | ✅ Yes | Same |
| `registerMockSignAddress` | ✅ Called externally | ✅ Called in `createBridges` | Same |

## `js.ts` / `js-injected.ts`

| Aspect | Working APK | Our Build | Impact |
|--------|------------|-----------|--------|
| Bridge function name | `createInjectedBridges` | `createBridges` | Naming only |
| `postSync` | `injectedPostSync` (custom) | Real `postSync` from synchronisation.ts | 🟡 Different post-processing |
| `shouldMergeOps` | `false` | `false` | Same |
| Mock signer wiring | Via `createMockSignerContext` at setup level | Via `createMockSignerContext` in `createBridges` | Same |

## Root cause of the "recovery phrase" error

The most likely remaining cause: the **wallet account preservation** during sync. When the account is synced, our version creates a fresh `walletAccount` via `wallet.generateAccount`. The working APK preserves the INITIAL wallet account and only updates its storage.

The fresh wallet account from `wallet.generateAccount` has a REAL explorer (not mock) that tries to connect to the Ledger explorer API. During signing, `signAccountTx` accesses `fromAccount.xpub.currentBlockHeight` and `fromAccount.xpub.explorer.getCurrentBlock()` — these go through the REAL explorer, which may fail or return unexpected data.

The working APK preserves the initial wallet account (which was created with the same `wallet.generateAccount` call), so the explorer is the same. But the key difference is that the working APK's wallet account has been through a full sync cycle (`wallet.syncAccount`), which populates the explorer's cache and block height.

Our fresh wallet account from `createCustomAccountShape` has NOT been synced — it only has UTXOs populated via `appendTxs`. The `currentBlockHeight` might be 0 or undefined, causing issues in `signAccountTx`.

## Recommended fix

Port the wallet account preservation logic from the working APK's `synchronisation-injected.ts` (lines 69-89) into our version. This ensures the wallet account's storage state is preserved across syncs, and the explorer cache is maintained.